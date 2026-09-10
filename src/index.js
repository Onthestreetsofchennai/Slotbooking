const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      const url = new URL(request.url);
      if (url.pathname === '/health') return json({ ok: true }, 200, cors);
      if (url.pathname === '/sql') return json({ ok: false, error: 'Direct SQL endpoint is disabled. Use /data/query.' }, 403, cors);
      if (url.pathname === '/data/query' && request.method === 'POST') return handleDataQuery(request, env, cors);
      if (url.pathname === '/auth/google' && request.method === 'POST') return handleGoogle(request, env, cors);
      if (url.pathname === '/auth/send-otp' && request.method === 'POST') return handleSendOtp(request, env, cors);
      if (url.pathname === '/auth/verify-otp' && request.method === 'POST') return handleVerifyOtp(request, env, cors);
      if (url.pathname === '/auth/register-email' && request.method === 'POST') return handleRegisterEmail(request, env, cors);
      if (url.pathname === '/client-error' && request.method === 'POST') return handleClientError(request, env, cors);
      if (url.pathname === '/push/register' && request.method === 'POST') return handlePushRegister(request, env, cors);
      if (url.pathname === '/push/register-admin' && request.method === 'POST') return handleAdminPushRegister(request, env, cors);
      if (url.pathname === '/push/admin-queue' && request.method === 'POST') return handleAdminQueuePush(request, env, cors);
      if (url.pathname === '/push/booking-status' && request.method === 'POST') return handleBookingStatusPush(request, env, cors);
      if (url.pathname === '/push/member-update' && request.method === 'POST') return handleMemberUpdatePush(request, env, cors);
      if (url.pathname === '/push/test' && request.method === 'POST') return handlePushTest(request, env, cors);
      return json({ ok: false, error: 'Not found' }, 404, cors);
    } catch (err) {
      console.error(err);
      return json({ ok: false, error: 'Server error' }, 500, cors);
    }
  }
};

function corsHeaders(request, env) {
  const origin = request.headers.get('origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const allowOrigin = !allowed.length || allowed.includes(origin) ? (origin || '*') : allowed[0];
  return {
    'access-control-allow-origin': allowOrigin,
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
    'access-control-max-age': '86400',
    'vary': 'Origin'
  };
}

function json(body, status = 200, cors = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...cors } });
}

async function readJson(request) {
  try { return await request.json(); } catch (_) { return {}; }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000, label = 'Request') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err && err.name === 'AbortError') throw new Error(`${label} timed out`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function neon(env, query, params = []) {
  const url = env.NEON_SQL_URL;
  const conn = env.NEON_CONNECTION_STRING;
  if (!url || !conn) throw new Error('Neon env vars are missing');
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Neon-Connection-String': conn
    },
    body: JSON.stringify({ query, params })
  }, 12000, 'Neon SQL request');
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  if (!data.fields || !data.rows) return [];
  return data.rows.map(row => {
    if (!Array.isArray(row)) return row;
    const out = {};
    data.fields.forEach((f, i) => out[f.name] = row[i]);
    return out;
  });
}

async function handleSqlProxy(request, env, cors) {
  const body = await readJson(request);
  const query = String(body.query || '').trim();
  const params = Array.isArray(body.params) ? body.params : [];
  if (!query) return json({ ok: false, error: 'Missing SQL query' }, 400, cors);

  const lowered = query.toLowerCase();
  const allowed = ['select', 'insert', 'update', 'delete', 'create table', 'alter table', 'create index'];
  if (!allowed.some(prefix => lowered.startsWith(prefix))) {
    return json({ ok: false, error: 'SQL operation is not allowed' }, 403, cors);
  }

  const rows = await neon(env, query, params);
  return json({ ok: true, rows }, 200, cors);
}

async function handleDataQuery(request, env, cors) {
  const body = await readJson(request);
  const query = String(body.query || '').trim();
  const params = Array.isArray(body.params) ? body.params : [];
  if (!query) return json({ ok: false, error: 'Missing SQL query' }, 400, cors);

  const lowered = query.toLowerCase();
  const allowed = ['select', 'insert', 'update', 'delete', 'create table', 'alter table', 'create index'];
  if (!allowed.some(prefix => lowered.startsWith(prefix))) {
    return json({ ok: false, error: 'Data operation is not allowed' }, 403, cors);
  }

  const rows = await neon(env, query, params);
  return json({ ok: true, rows }, 200, cors);
}

async function findMemberByEmail(env, email) {
  const rows = await neon(
    env,
    'SELECT id,name,email,phone,active FROM members WHERE LOWER(email) = $1 AND active IS NOT FALSE LIMIT 1',
    [String(email || '').trim().toLowerCase()]
  );
  return rows[0] || null;
}

function publicMember(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name || '',
    email: row.email || '',
    phone: row.phone || '',
    address: row.address || '',
    avatar_url: row.avatar_url || '',
    bio: row.bio || '',
    instrument: row.instrument || '',
    instagram: row.instagram || '',
    blood_group: row.blood_group || '',
    date_of_birth: row.date_of_birth || '',
    zone_current: row.zone_current || '',
    zone_request: row.zone_request || '',
    zone_request_reason: row.zone_request_reason || '',
    zone_request_status: row.zone_request_status || '',
    id_proof_url: row.id_proof_url || ''
  };
}

async function handleGoogle(request, env, cors) {
  const body = await readJson(request);
  const credential = body.credential || '';
  if (!credential) return json({ ok: false, error: 'Missing Google credential' }, 400, cors);

  const payload = await verifyGoogleIdToken(credential, env.GOOGLE_CLIENT_ID);
  if (!payload.email || payload.email_verified !== true) {
    return json({ ok: false, error: 'Google email is not verified' }, 401, cors);
  }

  const member = await findMemberByEmail(env, payload.email);
  if (!member) return json({ ok: false, error: 'This Google email is not registered in member data' }, 403, cors);

  const token = await signSession(env, publicMember(member), payload.sub);
  return json({ ok: true, member: publicMember(member), token }, 200, cors);
}

async function verifyGoogleIdToken(idToken, clientId) {
  if (!clientId) throw new Error('GOOGLE_CLIENT_ID is missing');
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Invalid Google token');
  const header = JSON.parse(textFromBase64Url(parts[0]));
  const payload = JSON.parse(textFromBase64Url(parts[1]));
  if (payload.aud !== clientId) throw new Error('Wrong Google audience');
  if (payload.iss !== 'accounts.google.com' && payload.iss !== 'https://accounts.google.com') throw new Error('Wrong Google issuer');
  if (!payload.exp || Number(payload.exp) * 1000 <= Date.now()) throw new Error('Google token expired');

  const jwks = await fetch('https://www.googleapis.com/oauth2/v3/certs').then(r => r.json());
  const jwk = (jwks.keys || []).find(k => k.kid === header.kid);
  if (!jwk) throw new Error('Google signing key not found');
  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    base64UrlToBytes(parts[2]),
    new TextEncoder().encode(parts[0] + '.' + parts[1])
  );
  if (!ok) throw new Error('Google token signature failed');
  return payload;
}

async function ensureOtpTable(env) {
  await neon(env, "CREATE TABLE IF NOT EXISTS member_auth_otps (session_id TEXT PRIMARY KEY, email TEXT NOT NULL, otp_hash TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL, attempts INTEGER DEFAULT 0, used BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())");
}

async function ensureClientErrorTable(env) {
  await neon(env, "CREATE TABLE IF NOT EXISTS client_error_reports (id TEXT PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT NOW(), app_version TEXT, source TEXT, severity TEXT, kind TEXT, route TEXT, message TEXT, stack TEXT, user_agent TEXT, platform TEXT, screen TEXT, online BOOLEAN, handled BOOLEAN DEFAULT false)");
}

async function ensurePushTokenTable(env) {
  await neon(env, "CREATE TABLE IF NOT EXISTS member_push_tokens (token TEXT PRIMARY KEY, email TEXT, phone TEXT, member_name TEXT, platform TEXT, device_label TEXT, app_version TEXT, active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), last_sent_at TIMESTAMPTZ)");
}

async function ensureAdminPushTokenTable(env) {
  await neon(env, "CREATE TABLE IF NOT EXISTS admin_push_tokens (token TEXT PRIMARY KEY, username TEXT, role TEXT, platform TEXT, device_label TEXT, app_version TEXT, active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), last_sent_at TIMESTAMPTZ)");
}

async function ensureBookingPushColumn(env) {
  await neon(env, "ALTER TABLE bookings ADD COLUMN IF NOT EXISTS push_token TEXT DEFAULT ''");
}

function limitText(value, max = 1800) {
  return String(value || '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/(\+?\d[\d\s().-]{7,}\d)/g, '[phone]')
    .replace(/postgresql:\/\/[^\s'"]+/gi, 'postgresql://[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/otp[=:]\s*\d{4,8}/gi, 'otp=[redacted]')
    .slice(0, max);
}

async function handleClientError(request, env, cors) {
  const body = await readJson(request);
  const id = limitText(body.id || crypto.randomUUID(), 80);
  const createdAt = body.createdAt ? new Date(body.createdAt) : new Date();
  await ensureClientErrorTable(env);
  await neon(
    env,
    'INSERT INTO client_error_reports (id, created_at, app_version, source, severity, kind, route, message, stack, user_agent, platform, screen, online, handled) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,false) ON CONFLICT (id) DO NOTHING',
    [
      id,
      isNaN(createdAt.getTime()) ? new Date().toISOString() : createdAt.toISOString(),
      limitText(body.appVersion, 80),
      limitText(body.source, 40),
      limitText(body.severity || 'error', 20),
      limitText(body.kind || 'runtime', 60),
      limitText(body.route, 120),
      limitText(body.message, 1800),
      limitText(body.stack, 1800),
      limitText(body.userAgent, 500),
      limitText(body.platform, 80),
      limitText(body.screen, 40),
      body.online !== false
    ]
  );
  return json({ ok: true }, 200, cors);
}

async function handlePushRegister(request, env, cors) {
  const body = await readJson(request);
  const token = limitText(body.token, 500);
  if (!token || token.length < 40) return json({ ok: false, error: 'Missing push token' }, 400, cors);
  await ensurePushTokenTable(env);
  await neon(
    env,
    'INSERT INTO member_push_tokens (token, email, phone, member_name, platform, device_label, app_version, active, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,true,NOW()) ON CONFLICT (token) DO UPDATE SET email=EXCLUDED.email, phone=EXCLUDED.phone, member_name=EXCLUDED.member_name, platform=EXCLUDED.platform, device_label=EXCLUDED.device_label, app_version=EXCLUDED.app_version, active=true, updated_at=NOW()',
    [
      token,
      limitText(body.email, 180).toLowerCase(),
      limitText(body.phone, 40),
      limitText(body.name, 180),
      limitText(body.platform || 'android', 40),
      limitText(body.deviceLabel, 120),
      limitText(body.appVersion, 80)
    ]
  );
  return json({ ok: true }, 200, cors);
}

async function handleAdminPushRegister(request, env, cors) {
  const body = await readJson(request);
  const token = limitText(body.token, 500);
  if (!token || token.length < 40) return json({ ok: false, error: 'Missing admin push token' }, 400, cors);
  await ensureAdminPushTokenTable(env);
  await neon(
    env,
    'INSERT INTO admin_push_tokens (token, username, role, platform, device_label, app_version, active, updated_at) VALUES ($1,$2,$3,$4,$5,$6,true,NOW()) ON CONFLICT (token) DO UPDATE SET username=EXCLUDED.username, role=EXCLUDED.role, platform=EXCLUDED.platform, device_label=EXCLUDED.device_label, app_version=EXCLUDED.app_version, active=true, updated_at=NOW()',
    [
      token,
      limitText(body.username || 'admin', 120),
      limitText(body.role || 'admin', 40),
      limitText(body.platform || 'android', 40),
      limitText(body.deviceLabel, 120),
      limitText(body.appVersion, 80)
    ]
  );
  return json({ ok: true }, 200, cors);
}

async function handleAdminQueuePush(request, env, cors) {
  const body = await readJson(request);
  const bookingId = limitText(body.bookingId || body.id, 120);
  const tokens = await findAdminPushTokens(env);
  if (!tokens.length) return json({ ok: true, sent: 0, reason: 'No registered admin device token' }, 200, cors);

  const performer = limitText(body.name || 'New performer', 120);
  const bookedBy = limitText(body.bookedBy || body.booked_by || '', 120);
  const venue = limitText(body.venue || '', 160);
  const date = limitText(body.date || '', 80);
  const eventType = limitText(body.eventType || body.type || '', 40).toLowerCase();
  const isCheckin = eventType === 'checkin' || eventType === 'reached';
  const isZoneApproval = eventType === 'zone_approval';
  const zone = limitText(body.zone || body.zoneRequest || '', 80);
  const checkinMapUrl = limitText(body.checkinMapUrl || body.mapUrl || '', 260);
  const checkinAt = limitText(body.checkinAt || '', 80);
  const checkinLat = limitText(body.checkinLat || '', 40);
  const checkinLng = limitText(body.checkinLng || '', 40);
  const title = isCheckin ? 'Performer has reached' : (isZoneApproval ? 'Zone approval needed' : 'New OTS slot request');
  const bodyText = isCheckin
    ? (venue ? `${performer}${bookedBy ? ' booked by ' + bookedBy : ''} reached ${venue}${date ? ' - ' + date : ''}${checkinMapUrl ? ' - location shared' : ''}` : `${performer}${bookedBy ? ' booked by ' + bookedBy : ''} marked reached${checkinMapUrl ? ' - location shared' : ''}`)
    : isZoneApproval
      ? `${performer} requested ${zone || 'a zone change'}`
      : (venue ? `${performer}${bookedBy ? ' booked by ' + bookedBy : ''} requested ${venue}${date ? ' - ' + date : ''}` : `${performer}${bookedBy ? ' booked by ' + bookedBy : ''} submitted a new request`);

  const results = [];
  for (const row of tokens) {
    results.push(await sendFirebaseMessage(env, row.token, {
      title,
      body: bodyText,
      data: {
        type: isCheckin ? 'admin_checkin' : (isZoneApproval ? 'admin_zone_approval' : 'admin_queue'),
        bookingId: String(bookingId || ''),
        venue,
        date,
        performer,
        bookedBy,
        zone,
        checkinAt,
        checkinLat,
        checkinLng,
        checkinMapUrl
      }
    }));
  }
  await neon(env, 'UPDATE admin_push_tokens SET last_sent_at=NOW() WHERE token = ANY($1)', [tokens.map(t => t.token)]);
  return json({ ok: true, sent: results.filter(Boolean).length, attempted: tokens.length }, 200, cors);
}

async function handleBookingStatusPush(request, env, cors) {
  const body = await readJson(request);
  const bookingId = limitText(body.bookingId || body.id, 120);
  const status = limitText(body.status, 40).toLowerCase();
  if (!bookingId || !status) return json({ ok: false, error: 'Missing booking status data' }, 400, cors);

  await ensureBookingPushColumn(env);
  const rows = await neon(env, 'SELECT id, venue, date, name, phone, email, status, push_token FROM bookings WHERE id=$1 LIMIT 1', [bookingId]);
  const booking = rows[0] || {
    id: bookingId,
    venue: body.venue || '',
    date: body.date || '',
    name: body.name || '',
    phone: body.phone || '',
    email: body.email || '',
    push_token: body.pushToken || body.push_token || '',
    status
  };
  let email = String(booking.email || body.email || '').trim().toLowerCase();
  let phone10 = normalizePhone10(booking.phone || body.phone || '');
  let tokens = [];
  const directToken = limitText(booking.push_token || body.pushToken || body.push_token || '', 500);
  if (directToken && directToken.length >= 40) tokens.push({ token: directToken });
  tokens = mergeTokenRows(tokens, await findPushTokensForMember(env, email, phone10));
  if (!tokens.length) {
    const memberRows = await findMemberContactForPush(env, email, phone10);
    if (memberRows.length) {
      email = String(memberRows[0].email || email || '').trim().toLowerCase();
      phone10 = normalizePhone10(memberRows[0].phone || phone10 || '');
      tokens = mergeTokenRows(tokens, await findPushTokensForMember(env, email, phone10));
    }
  }
  if (!tokens.length) return json({ ok: true, sent: 0, reason: 'No registered device token for this member' }, 200, cors);

  const title = status === 'confirmed'
    ? 'Your OTS slot is confirmed'
    : status === 'rejected'
      ? 'Your OTS slot was rejected'
      : status === 'cancelled'
        ? 'Your OTS slot was cancelled'
        : 'Your OTS slot was updated';
  const bodyText = booking.venue
    ? `${booking.venue}${booking.date ? ' - ' + booking.date : ''}`
    : 'Open OTS Booking to view the update.';

  const results = [];
  for (const row of tokens) {
    results.push(await sendFirebaseMessage(env, row.token, {
      title,
      body: bodyText,
      data: {
        type: 'booking_status',
        bookingId: String(booking.id || bookingId),
        status,
        venue: String(booking.venue || ''),
        date: String(booking.date || '')
      }
    }));
  }
  await neon(env, 'UPDATE member_push_tokens SET last_sent_at=NOW() WHERE token = ANY($1)', [tokens.map(t => t.token)]);
  return json({ ok: true, sent: results.filter(Boolean).length, attempted: tokens.length }, 200, cors);
}

async function handleMemberUpdatePush(request, env, cors) {
  const body = await readJson(request);
  const updateType = limitText(body.updateType || body.type || 'member_update', 80).toLowerCase();
  const status = limitText(body.status || '', 40).toLowerCase();
  const bookingId = limitText(body.bookingId || body.booking_id || '', 120);
  const claimId = limitText(body.claimId || body.claim_id || '', 120);
  const venue = limitText(body.venue || '', 160);
  const date = limitText(body.date || '', 80);
  const points = limitText(body.points || '', 40);
  const reason = limitText(body.reason || '', 220);
  const senderPhone = limitText(body.senderPhone || body.chatPeerPhone || body.peerPhone || '', 40);

  let email = String(body.email || '').trim().toLowerCase();
  let phone10 = normalizePhone10(body.phone || body.memberPhone || body.member_phone || '');
  let memberName = limitText(body.name || body.memberName || body.member_name || 'Member', 120);

  if (bookingId && (!email || !phone10 || !venue || !date)) {
    try {
      const bookingRows = await neon(env, 'SELECT id, venue, date, name, phone, email FROM bookings WHERE id=$1 LIMIT 1', [bookingId]);
      if (bookingRows.length) {
        const b = bookingRows[0];
        email = email || String(b.email || '').trim().toLowerCase();
        phone10 = phone10 || normalizePhone10(b.phone || '');
        memberName = memberName === 'Member' ? limitText(b.name || memberName, 120) : memberName;
      }
    } catch (e) {
      console.warn('Booking lookup for member update failed:', e && (e.message || e));
    }
  }

  let tokens = await findPushTokensForMember(env, email, phone10);
  if (!tokens.length) {
    const memberRows = await findMemberContactForPush(env, email, phone10);
    if (memberRows.length) {
      email = String(memberRows[0].email || email || '').trim().toLowerCase();
      phone10 = normalizePhone10(memberRows[0].phone || phone10 || '');
      tokens = await findPushTokensForMember(env, email, phone10);
    }
  }
  if (!tokens.length) return json({ ok: true, sent: 0, reason: 'No registered device token for this member' }, 200, cors);

  const title = memberUpdateTitle(updateType, status);
  const bodyText = memberUpdateBody(updateType, status, { venue, date, points, reason, memberName });
  const results = [];
  for (const row of tokens) {
    results.push(await sendFirebaseMessage(env, row.token, {
      title,
      body: bodyText,
      data: {
        type: 'member_update',
        updateType,
        status,
        bookingId,
        claimId,
        venue,
        date,
        points,
        reason,
        memberName,
        senderPhone,
        chatPeerPhone: senderPhone
      }
    }));
  }
  await neon(env, 'UPDATE member_push_tokens SET last_sent_at=NOW() WHERE token = ANY($1)', [tokens.map(t => t.token)]);
  return json({ ok: true, sent: results.filter(Boolean).length, attempted: tokens.length }, 200, cors);
}

function memberUpdateTitle(updateType, status) {
  if (updateType === 'chat_message') return 'New OTS chat message';
  if (updateType === 'claim' && status === 'approved') return 'Your OTS claim is approved';
  if (updateType === 'claim' && status === 'rejected') return 'Your OTS claim was rejected';
  if (updateType === 'points' || updateType === 'reward') return 'OTS points update';
  if (updateType === 'withdraw') return 'OTS points withdrawn';
  if (status === 'approved' || status === 'confirmed') return 'Your OTS update is approved';
  if (status === 'rejected') return 'Your OTS update was rejected';
  return 'OTS Booking update';
}

function memberUpdateBody(updateType, status, detail) {
  const venueLine = detail.venue ? `${detail.venue}${detail.date ? ' - ' + detail.date : ''}` : '';
  if (updateType === 'chat_message') {
    return `${detail.memberName || 'A member'}: ${detail.reason || 'Open OTS Booking to view the message.'}`;
  }
  if (updateType === 'claim' && status === 'approved') {
    return `${venueLine || 'Your proof claim'} was approved${detail.points ? ' - ' + detail.points + ' point(s)' : ''}.`;
  }
  if (updateType === 'claim' && status === 'rejected') return `${venueLine || 'Your proof claim'} was rejected.`;
  if (updateType === 'points' || updateType === 'reward') {
    return `${detail.points || 'New'} point(s) added${detail.reason ? ' for ' + detail.reason : ''}.`;
  }
  if (updateType === 'withdraw') return `A point was withdrawn${detail.reason ? ' - ' + detail.reason : ''}.`;
  return venueLine || 'Open OTS Booking to view the latest update.';
}

async function handlePushTest(request, env, cors) {
  const body = await readJson(request);
  const token = limitText(body.token, 500);
  if (!token) return json({ ok: false, error: 'Missing token' }, 400, cors);
  const ok = await sendFirebaseMessage(env, token, {
    title: 'OTS notifications are ready',
    body: 'You will receive slot updates here.',
    data: { type: 'push_test' }
  });
  return json({ ok: !!ok }, ok ? 200 : 500, cors);
}

async function findPushTokensForMember(env, email, phone10) {
  await ensurePushTokenTable(env);
  return neon(
    env,
    "SELECT token FROM member_push_tokens WHERE active IS TRUE AND ((LOWER(TRIM(email)) = $1 AND $1 <> '') OR (RIGHT(REGEXP_REPLACE(phone,'[^0-9]','','g'),10) = $2 AND $2 <> '')) ORDER BY updated_at DESC LIMIT 5",
    [email || '', phone10 || '']
  );
}

function mergeTokenRows(...groups) {
  const seen = new Set();
  const out = [];
  for (const group of groups) {
    for (const row of (group || [])) {
      const token = String(row && row.token || '').trim();
      if (!token || seen.has(token)) continue;
      seen.add(token);
      out.push({ token });
    }
  }
  return out;
}

async function findMemberContactForPush(env, email, phone10) {
  try {
    return neon(
      env,
      "SELECT email, phone FROM members WHERE active IS TRUE AND ((LOWER(TRIM(email)) = $1 AND $1 <> '') OR (RIGHT(REGEXP_REPLACE(phone,'[^0-9]','','g'),10) = $2 AND $2 <> '')) LIMIT 1",
      [email || '', phone10 || '']
    );
  } catch (e) {
    console.warn('Member contact lookup failed:', e && (e.message || e));
    return [];
  }
}

async function findAdminPushTokens(env) {
  await ensureAdminPushTokenTable(env);
  return neon(
    env,
    "SELECT token FROM admin_push_tokens WHERE active IS TRUE ORDER BY updated_at DESC LIMIT 20",
    []
  );
}

function normalizePhone10(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

async function sendFirebaseMessage(env, token, payload) {
  const accessToken = await getFirebaseAccessToken(env);
  const projectId = env.FIREBASE_PROJECT_ID || firebaseServiceAccount(env).project_id;
  if (!projectId) throw new Error('FIREBASE_PROJECT_ID is missing');
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      message: {
        token,
        notification: {
          title: String(payload.title || ''),
          body: String(payload.body || '')
        },
        data: Object.assign(
          {
            title: String(payload.title || ''),
            body: String(payload.body || '')
          },
          Object.fromEntries(Object.entries(payload.data || {}).map(([k, v]) => [k, String(v)]))
        ),
        android: {
          priority: 'HIGH',
          notification: {
            channel_id: 'ots_booking_updates',
            sound: 'default'
          }
        }
      }
    })
  });
  if (!res.ok) {
    const text = await res.text();
    console.error('FCM send failed:', text);
    return false;
  }
  return true;
}

async function getFirebaseAccessToken(env) {
  const serviceAccount = firebaseServiceAccount(env);
  if (!serviceAccount.client_email || !serviceAccount.private_key) throw new Error('Firebase service account is incomplete');
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claim = base64Url(new TextEncoder().encode(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  })));
  const signingInput = `${header}.${claim}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(serviceAccount.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
  const jwt = `${signingInput}.${base64Url(new Uint8Array(signature))}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.access_token;
}

function firebaseServiceAccount(env) {
  if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON secret is missing');
  return JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
}

function pemToArrayBuffer(pem) {
  const b64 = String(pem)
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out.buffer;
}

async function handleSendOtp(request, env, cors) {
  const body = await readJson(request);
  const missing = missingAuthEnv(env);
  if (missing.length) return json({ ok: false, error: 'Email OTP server is not configured: ' + missing.join(', ') }, 503, cors);
  const email = String(body.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: 'Invalid email' }, 400, cors);

  const member = await findMemberByEmail(env, email);
  if (!member) return json({ ok: false, error: 'This email is not registered in member data' }, 403, cors);

  await ensureOtpTable(env);
  const recent = await neon(env, "SELECT COUNT(*)::int AS count FROM member_auth_otps WHERE email=$1 AND created_at > NOW() - INTERVAL '1 hour'", [email]);
  if (Number(recent[0]?.count || 0) >= 5) return json({ ok: false, error: 'Too many OTP requests. Try again later.' }, 429, cors);

  const last = await neon(env, "SELECT EXTRACT(EPOCH FROM (NOW() - created_at))::int AS seconds FROM member_auth_otps WHERE email=$1 ORDER BY created_at DESC LIMIT 1", [email]);
  if (last.length && Number(last[0].seconds || 999) < 60) return json({ ok: false, error: 'Please wait 60 seconds before requesting another OTP.' }, 429, cors);

  const otp = makeOtp();
  const sessionId = crypto.randomUUID();
  const otpHash = await sha256Hex(`${otp}:${sessionId}:${env.OTP_SECRET}`);
  try {
    await sendOtpEmail(env, email, otp);
  } catch (err) {
    console.error('OTP email send failed', err);
    return json({ ok: false, error: 'Could not send OTP email right now. Please contact admin/helpdesk.' }, 502, cors);
  }
  await neon(env, "INSERT INTO member_auth_otps (session_id,email,otp_hash,expires_at) VALUES ($1,$2,$3,NOW() + INTERVAL '5 minutes')", [sessionId, email, otpHash]);

  return json({ ok: true, sessionId, email, member: { name: member.name || '', email: member.email || '' }, expiresIn: 300 }, 200, cors);
}

async function handleVerifyOtp(request, env, cors) {
  const body = await readJson(request);
  if (!env.OTP_SECRET) return json({ ok: false, error: 'OTP server secret is missing' }, 503, cors);
  const email = String(body.email || '').trim().toLowerCase();
  const sessionId = String(body.sessionId || '');
  const otp = String(body.otp || '').trim();
  if (!email || !sessionId || !/^\d{6}$/.test(otp)) return json({ ok: false, error: 'Invalid OTP request' }, 400, cors);

  await ensureOtpTable(env);
  const rows = await neon(env, "SELECT session_id,email,otp_hash,expires_at,attempts,used FROM member_auth_otps WHERE session_id=$1 AND email=$2 LIMIT 1", [sessionId, email]);
  const row = rows[0];
  if (!row || row.used) return json({ ok: false, error: 'OTP expired or already used' }, 401, cors);
  if (new Date(row.expires_at).getTime() <= Date.now()) return json({ ok: false, error: 'OTP expired' }, 401, cors);
  if (Number(row.attempts || 0) >= 5) return json({ ok: false, error: 'Too many wrong attempts' }, 429, cors);

  const expected = await sha256Hex(`${otp}:${sessionId}:${env.OTP_SECRET}`);
  if (expected !== row.otp_hash) {
    await neon(env, "UPDATE member_auth_otps SET attempts=attempts+1 WHERE session_id=$1", [sessionId]);
    return json({ ok: false, error: 'Wrong OTP' }, 401, cors);
  }

  await neon(env, "UPDATE member_auth_otps SET used=true WHERE session_id=$1", [sessionId]);
  const member = await findMemberByEmail(env, email);
  if (!member) return json({ ok: false, error: 'Member no longer active' }, 403, cors);
  const token = await signSession(env, publicMember(member), null);
  return json({ ok: true, member: publicMember(member), token }, 200, cors);
}

async function handleRegisterEmail(request, env, cors) {
  const body = await readJson(request);
  const phoneTen = normalizePhone(body.phone);
  const email = String(body.email || '').trim().toLowerCase();
  if (!phoneTen || phoneTen.length !== 10) return json({ ok: false, error: 'Enter the registered mobile number.' }, 400, cors);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: 'Enter a valid email address.' }, 400, cors);

  const memberRows = await neon(
    env,
    "SELECT id,name,email,phone,active FROM members WHERE RIGHT(REGEXP_REPLACE(COALESCE(phone,''),'[^0-9]','','g'),10) = $1 AND active IS NOT FALSE LIMIT 1",
    [phoneTen]
  );
  if (!memberRows.length) {
    return json({ ok: false, error: 'This phone number is not registered as a member. Please contact admin for help.' }, 403, cors);
  }

  const member = memberRows[0];
  const existingEmail = String(member.email || '').trim().toLowerCase();
  if (existingEmail && existingEmail !== email) {
    return json({ ok: false, error: 'This phone already has an email saved. Contact admin or helpdesk to change it.' }, 409, cors);
  }

  const emailRows = await neon(
    env,
    "SELECT id, phone FROM members WHERE LOWER(COALESCE(email,'')) = $1 AND active IS NOT FALSE LIMIT 1",
    [email]
  );
  if (emailRows.length && normalizePhone(emailRows[0].phone) !== phoneTen) {
    return json({ ok: false, error: 'This email is already used by another member. Use another email or contact admin/helpdesk.' }, 409, cors);
  }

  if (!existingEmail) {
    if (member.id != null) {
      await neon(env, 'UPDATE members SET email=$1 WHERE id=$2', [email, member.id]);
    } else {
      await neon(
        env,
        "UPDATE members SET email=$1 WHERE RIGHT(REGEXP_REPLACE(COALESCE(phone,''),'[^0-9]','','g'),10) = $2 AND active IS NOT FALSE",
        [email, phoneTen]
      );
    }
  }

  const fresh = await findMemberByEmail(env, email);
  return json({ ok: true, member: publicMember(fresh || { ...member, email }) }, 200, cors);
}

async function sendOtpEmail(env, to, otp) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) throw new Error('Email env vars are missing');
  const res = await fetchWithTimeout('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [to],
      subject: 'Your OTS login OTP',
      html: `<p>Your On The Streets login OTP is:</p><h2>${otp}</h2><p>This code expires in 5 minutes.</p>`,
      text: `Your On The Streets login OTP is ${otp}. This code expires in 5 minutes.`
    })
  }, 10000, 'Resend email request');
  if (!res.ok) throw new Error(await res.text());
}

function makeOtp() {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(100000 + (bytes[0] % 900000));
}

function missingAuthEnv(env) {
  return ['OTP_SECRET', 'RESEND_API_KEY', 'EMAIL_FROM']
    .filter(name => !String(env[name] || '').trim());
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

async function signSession(env, member, googleSub) {
  const payload = {
    sub: String(member.id || member.email || ''),
    googleSub: googleSub || '',
    email: member.email || '',
    phone: member.phone || '',
    name: member.name || '',
    exp: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60)
  };
  const body = base64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmacSha256(env.SESSION_SECRET || env.OTP_SECRET, body);
  return body + '.' + sig;
}

async function hmacSha256(secret, value) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const encodedValue = new TextEncoder().encode(value);
  const sig = await crypto.subtle.sign('HMAC', key, encodedValue);
  return base64Url(new Uint8Array(sig));
}

async function sha256Hex(value) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function textFromBase64Url(value) {
  return new TextDecoder().decode(base64UrlToBytes(value));
}

function base64UrlToBytes(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const bin = atob(base64);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

function base64Url(bytes) {
  let bin = '';
  bytes.forEach(b => bin += String.fromCharCode(b));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
