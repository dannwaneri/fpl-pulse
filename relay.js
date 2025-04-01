const axios = require('axios');
const WebSocket = require('ws');

const FPL_COOKIE = 'sessionid=.eJxVysEKQiEQheF3cR2XRkdH27UPCi6tZRwVo4jI7ip697y7Wp7z_W8VeXm1uPTyjJesdorIBA8IavNLieVa7qs_btN6T6fDeUCf5-N-zP-6cW8jDRach5yINVupCYMNBsiS14jiqqARXQQpZ976jJbEkBdgguJdNerzBTDkMXg:1tuizr:7MgIpbqF_XCM0A25442quSi3VOv83m4R8-G1l-Vd8JI; csrftoken=WU9QhBMGdv5ziwAPxTdS3gEuz9Zluczf; datadome=Hc5uAGmEx3lJO~yXdC8WJx~0fZ42HYXGMPy41ruPf_woymk2v2nl338j_wLmbSv4relq2nPkN0aI0UQHPnj7uxHmcT74oORfaHiia2VYn21gY_kqfA3PMc3DLLtxwHqQ';
const RENDER_URL = 'wss://fpl-pulse.onrender.com/ws'; // Add WebSocket endpoint to Render

async function fetchAndRelay(gameweek) {
  try {
    const response = await axios.get(`https://fantasy.premierleague.com/api/event/${gameweek}/live/`, {
      headers: {
        'Cookie': FPL_COOKIE,
        'User-Agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Mobile Safari/537.36',
        'Accept': 'application/json'
      }
    });
    const data = response.data;
    console.log(data)

    const ws = new WebSocket(RENDER_URL);
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'liveData', gameweek, data }));
      console.log(`Relayed GW ${gameweek} data to Render`);
      ws.close();
    });
    ws.on('error', (err) => console.error('WebSocket error:', err));
  } catch (err) {
    console.error('Fetch error:', err.message);
  }
}

// Run every 5 minutes
setInterval(() => fetchAndRelay(29), 5 * 60 * 1000);
fetchAndRelay(29); // Initial fetch