const fetch = require('node-fetch');

const cookies = 'sessionid=.eJxVysEKQiEQheF3cR2XRkdH27UPCi6tZRwVo4jI7ip697y7Wp7z_W8VeXm1uPTyjJesdorIBA8IavNLieVa7qs_btN6T6fDeUCf5-N-zP-6cW8jDRach5yINVupCYMNBsiS14jiqqARXQQpZ976jJbEkBdgguJdNerzBTDkMXg:1tuizr:7MgIpbqF_XCM0A25442quSi3VOv83m4R8-G1l-Vd8JI; pl_profile="eyJzIjogIld6SXNOemN6T1RneE5ERmQ6MXR1aXpwOlhYa2JheHh0U3dvT1ZQY0NjWThQbzV2VFVhMHUzelV2cXpSb004N09SaDQiLCAidSI6IHsiaWQiOiA3NzM9ODE0MSwgImZuIjogIkRhbmllbCIsICJsbiI6ICJOd2FuZXJpIiwgImZjIjogMTR9fQ=="; csrftoken=WU9QhBMGdv5ziwAPxTdS3gEuz9Zluczf';
const url = 'https://fantasy.premierleague.com/api/event/29/live/';

fetch(url, {
  headers: {
    'Cookie': cookies,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Origin': 'https://fantasy.premierleague.com',
    'Referer': 'https://fantasy.premierleague.com/en/statistics'
  }
})
  .then(res => {
    console.log('Status:', res.status);
    return res.json();
  })
  .then(data => console.log('Response:', data))
  .catch(err => console.error('Error:', err));