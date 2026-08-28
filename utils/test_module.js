const { login } = require('./login');

(async () => {
  const res = await login();
  if (res.success) {
    console.log('✅ 登录成功');
    console.log('   token:', res.token);
    console.log('   用户:', res.data.user.realname, `(${res.data.user.name})`);
  } else {
    console.log('❌ 登录失败:', res.error);
  }
  process.exit(0);
})();
