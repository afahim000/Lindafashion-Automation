const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {google} = require('googleapis');

const tokenPath = path.join(__dirname, '..', 'data', 'gmail-oauth.json');
const pendingStates = new Map();

function oauthConfig(env = process.env)
{
    let fileConfig = {};
    if(env.GOOGLE_OAUTH_CREDENTIALS_PATH)
    {
        try
        {
            const credentials = JSON.parse(fs.readFileSync(env.GOOGLE_OAUTH_CREDENTIALS_PATH, 'utf8'));
            fileConfig = credentials.web || credentials.installed || {};
        }
        catch(error) { fileConfig = {}; }
    }
    return {
        clientId: env.GOOGLE_CLIENT_ID || fileConfig.client_id || '',
        clientSecret: env.GOOGLE_CLIENT_SECRET || fileConfig.client_secret || '',
        redirectUri: env.GOOGLE_REDIRECT_URI || fileConfig.redirect_uris?.[0] || 'http://localhost:2000/shipping-quote/google/callback',
    };
}

function oauthClient(env = process.env)
{
    const config = oauthConfig(env);
    if(!config.clientId || !config.clientSecret)
    {
        const error = new Error('Google OAuth is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to backend/.env.');
        error.code = 'GOOGLE_OAUTH_NOT_CONFIGURED';
        throw error;
    }
    return new google.auth.OAuth2(config.clientId, config.clientSecret, config.redirectUri);
}

function readSavedAuthorization()
{
    try { return JSON.parse(fs.readFileSync(tokenPath, 'utf8')); }
    catch(error) { return null; }
}

function writeSavedAuthorization(authorization)
{
    fs.mkdirSync(path.dirname(tokenPath), {recursive: true});
    const temporaryPath = `${tokenPath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(authorization, null, 2), {mode: 0o600});
    fs.renameSync(temporaryPath, tokenPath);
}

function googleConnectionStatus(env = process.env)
{
    const config = oauthConfig(env);
    const saved = readSavedAuthorization();
    return {configured: Boolean(config.clientId && config.clientSecret), connected: Boolean(saved?.tokens?.refresh_token), email: saved?.email || ''};
}

function createAuthorizationUrl(env = process.env)
{
    const client = oauthClient(env);
    const state = crypto.randomBytes(24).toString('hex');
    pendingStates.set(state, Date.now() + 10 * 60 * 1000);
    return client.generateAuthUrl({
        access_type: 'offline', prompt: 'consent', state,
        scope: [
            'openid',
            'email',
            'https://www.googleapis.com/auth/gmail.send',
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive.readonly',
        ],
    });
}

async function completeAuthorization(code, state, env = process.env)
{
    const expiresAt = pendingStates.get(state);
    pendingStates.delete(state);
    if(!expiresAt || expiresAt < Date.now()) throw new Error('The Google login request expired. Return to Shipping Quote and click Connect Gmail again.');
    const client = oauthClient(env);
    const {tokens} = await client.getToken(code);
    const existing = readSavedAuthorization();
    if(!tokens.refresh_token && existing?.tokens?.refresh_token) tokens.refresh_token = existing.tokens.refresh_token;
    client.setCredentials(tokens);
    const profile = await google.oauth2({version: 'v2', auth: client}).userinfo.get();
    const authorization = {email: profile.data.email || '', tokens, connectedAt: new Date().toISOString()};
    writeSavedAuthorization(authorization);
    return authorization;
}

function gmailClient(env = process.env)
{
    const saved = readSavedAuthorization();
    if(!saved?.tokens?.refresh_token)
    {
        const error = new Error('Connect Gmail before sending a quote request.');
        error.code = 'GMAIL_NOT_CONNECTED';
        throw error;
    }
    const client = oauthClient(env);
    client.setCredentials(saved.tokens);
    return {gmail: google.gmail({version: 'v1', auth: client}), email: saved.email};
}

function authorizedGoogleClient(env = process.env)
{
    const saved = readSavedAuthorization();
    if(!saved?.tokens?.refresh_token)
    {
        const error = new Error('Connect Google before recording the order to the spreadsheet.');
        error.code = 'GOOGLE_NOT_CONNECTED';
        throw error;
    }
    const client = oauthClient(env);
    client.setCredentials(saved.tokens);
    return client;
}

function base64Url(value)
{
    return Buffer.from(value, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sendGmailMessage({to, subject, text}, env = process.env)
{
    if(!to) throw new Error('UCL_QUOTE_EMAIL_TO is not configured in backend/.env.');
    const {gmail, email} = gmailClient(env);
    const raw = [`From: ${email}`, `To: ${to}`, `Subject: ${subject}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: 8bit', '', text].join('\r\n');
    const response = await gmail.users.messages.send({userId: 'me', requestBody: {raw: base64Url(raw)}});
    return {messageId: response.data.id, recipient: to, sender: email};
}

module.exports = {googleConnectionStatus, createAuthorizationUrl, completeAuthorization, sendGmailMessage, authorizedGoogleClient};
