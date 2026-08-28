const { login, httpRequest } = require('./login');

(async () => {
  // 1. 登录拿 token
  const res = await login();
  if (!res.success) {
    console.log('❌ 登录失败:', res.error);
    process.exit(1);
  }
  console.log('✅ 登录成功，token:', res.token.substring(0, 20) + '...');
  console.log('');

  // 2. 带 token 调用拓扑列表接口
  try {
    const list = await httpRequest({
      url: '/topology/topos/',
      method: 'GET',
      token: res.token,
    });
    console.log('===== GET /topology/topos/ 返回 =====');
    console.log(JSON.stringify(list, null, 2).substring(0, 2000));
  } catch (err) {
    console.log('❌ 请求失败:', err.message);
  }
  process.exit(0);
})();
