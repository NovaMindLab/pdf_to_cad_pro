const http = require('http');
const md5 = require('./md5');

const PLATFORM_BASE = 'http://xrdc.3ddcim.com/v1';
const { URL } = require('url');

function httpRequest({ url, method = 'GET', data, token }) {
  return new Promise((resolve, reject) => {
    const fullUrl = new URL(`${PLATFORM_BASE}${url}`);
    const body = data ? JSON.stringify(data) : null;

    const options = {
      hostname: fullUrl.hostname,
      port: fullUrl.port || 80,
      path: fullUrl.pathname + fullUrl.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': body ? Buffer.byteLength(body) : 0,
      },
    };

    if (token) {
      options.headers['Cookie'] = `xr3d_token=${token}`;
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        try {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve(JSON.parse(text));
        } catch (e) {
          reject(new Error('Failed to parse response'));
        }
      });
    });

    req.on('error', (err) => reject(err));
    if (body) req.write(body);
    req.end();
  });
}

async function signLogin(data) {
  return httpRequest({ url: '/SignLogin', method: 'POST', data });
}

async function login() {
  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const params = `${timestamp}_nijunwen_e4daded24a4a2b0e57d70ab52790deba`;
    const signature = md5(params);
    const res = await signLogin({ signature, timestamp, username: 'nijunwen' });

    if (res && res.code === 0 && res.data && res.data.iAuthToken) {
      console.log('[平台] 登录成功，用户:', res.data.user ? res.data.user.realname : '未知');
      return { success: true, token: res.data.iAuthToken, data: res.data };
    }
    const reason = (res && (res.message || res.msg)) || '登录接口返回异常';
    console.error('[平台] 登录失败:', reason, JSON.stringify(res).substring(0, 200));
    return { success: false, error: reason };
  } catch (err) {
    console.error('[平台] 登录异常:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { login, httpRequest };