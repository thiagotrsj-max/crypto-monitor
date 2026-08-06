/**
 * app.js — Estado da aplicação, orquestração de dados, renderização das views e o gráfico.
 * Depende de: CryptoAPI (api.js), Indicators (indicators.js), AlertsEngine (alerts.js) e da
 * biblioteca global `LightweightCharts` (carregada via CDN no index.html).
 */

// ----------------------------------------------------------------------------------------------
// Constantes e estado
// ----------------------------------------------------------------------------------------------

const CRYPTO_LIST = [
  { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' },
  { id: 'ethereum', symbol: 'ETH', name: 'Ethereum' },
  { id: 'solana', symbol: 'SOL', name: 'Solana' },
  { id: 'binancecoin', symbol: 'BNB', name: 'BNB' },
  { id: 'ripple', symbol: 'XRP', name: 'XRP' },
  { id: 'cardano', symbol: 'ADA', name: 'Cardano' },
  { id: 'dogecoin', symbol: 'DOGE', name: 'Dogecoin' },
  { id: 'chainlink', symbol: 'LINK', name: 'Chainlink' },
  { id: 'avalanche-2', symbol: 'AVAX', name: 'Avalanche' },
  { id: 'matic-network', symbol: 'MATIC', name: 'Polygon' },
];
const CRYPTO_BY_ID = Object.fromEntries(CRYPTO_LIST.map((c) => [c.id, c]));

// Lista de memecoins para a aba dedicada (🐸 Memecoins). Isolada de propósito da lista principal:
// não entra no polling automático nem no sistema de alertas/favoritos — só é buscada (1 chamada
// à API, todas de uma vez) quando o usuário abre a aba ou clica em Atualizar. Isso evita somar
// mais chamadas ao ciclo de atualização automático, que já esbarra no rate-limit da CoinGecko
// free tier com apenas os 10 ativos principais.
const MEMECOIN_LIST = [
  { id: 'shiba-inu', symbol: 'SHIB', name: 'Shiba Inu' },
  { id: 'pepe', symbol: 'PEPE', name: 'Pepe' },
  { id: 'floki', symbol: 'FLOKI', name: 'Floki' },
  { id: 'bonk', symbol: 'BONK', name: 'Bonk' },
  { id: 'dogwifcoin', symbol: 'WIF', name: 'dogwifhat' },
  { id: 'baby-doge-coin', symbol: 'BABYDOGE', name: 'Baby Doge Coin' },
  { id: 'mog-coin', symbol: 'MOG', name: 'Mog Coin' },
  { id: 'based-brett', symbol: 'BRETT', name: 'Brett' },
  { id: 'popcat', symbol: 'POPCAT', name: 'Popcat' },
  { id: 'book-of-meme', symbol: 'BOME', name: 'Book of Meme' },
  { id: 'cat-in-a-dogs-world', symbol: 'MEW', name: 'cat in a dogs world' },
  { id: 'dogelon-mars', symbol: 'ELON', name: 'Dogelon Mars' },
  { id: 'wojak', symbol: 'WOJAK', name: 'Wojak' },
  { id: 'turbo', symbol: 'TURBO', name: 'Turbo' },
  { id: 'jeo-boden', symbol: 'BODEN', name: 'Jeo Boden' },
  { id: 'slerf', symbol: 'SLERF', name: 'Slerf' },
  { id: 'myro', symbol: 'MYRO', name: 'Myro' },
  { id: 'ponke', symbol: 'PONKE', name: 'Ponke' },
  { id: 'degen-base', symbol: 'DEGEN', name: 'Degen' },
  { id: 'samoyedcoin', symbol: 'SAMO', name: 'Samoyedcoin' },
  { id: 'hoge-finance', symbol: 'HOGE', name: 'Hoge Finance' },
  { id: 'akita-inu', symbol: 'AKITA', name: 'Akita Inu' },
  { id: 'kishu-inu', symbol: 'KISHU', name: 'Kishu Inu' },
  { id: 'catecoin', symbol: 'CATE', name: 'Catecoin' },
  { id: 'shiba-predator', symbol: 'QOM', name: 'Shiba Predator' },
  { id: 'landwolf-0x67', symbol: 'WOLF', name: 'Landwolf' },
  { id: 'pitbull', symbol: 'PIT', name: 'Pitbull' },
  { id: 'volt-inu-2', symbol: 'VOLT', name: 'Volt Inu' },
];
const MEMECOIN_BY_ID = Object.fromEntries(MEMECOIN_LIST.map((c) => [c.id, c]));
// Lookup combinado (principais + memecoins) — usado em qualquer lugar que precise exibir nome/
// símbolo de um ativo que pode ser de qualquer uma das duas listas (alertas, histórico), já que
// alertas agora podem ser criados para memecoins também.
const ALL_COINS_BY_ID = { ...CRYPTO_BY_ID, ...MEMECOIN_BY_ID };

const SETTINGS_KEY = 'crypto_monitor_settings';
const FAVORITES_KEY = 'crypto_monitor_favorites';

const DEFAULT_SETTINGS = {
  currency: 'usd',
  interval: 30000,
  theme: 'dark',
  notifications: true,
  sounds: true,
  volume: 50,
  hourFormat: '24h',
  decimals: 2,
  defaultPeriod: '1d',
  defaultIndicators: ['sma20', 'ema21'],
};

const CURRENCY_SYMBOL = { usd: '$', brl: 'R$', eur: '€' };

const state = {
  settings: loadSettings(),
  favorites: loadFavorites(),
  currentAssetId: 'bitcoin',
  currentTimeframe: 'dark' === null ? '1d' : DEFAULT_SETTINGS.defaultPeriod,
  activeIndicators: new Set(['sma20', 'ema21']),
  marketsById: {},
  contextById: {},
  demoManual: false,
  demoAuto: false,
  currentView: 'dashboard',
  sortState: { key: 'name', dir: 1 },
  memecoinsById: {},
  memecoinsLoaded: false,
  memecoinsLoading: false,
  memecoinsSortState: { key: 'change', dir: -1 }, // por padrão, maiores altas primeiro
  pollTimer: null,
  chart: null,
  candleSeries: null,
  overlaySeries: {},
  volumeSeries: null,
};

state.currentTimeframe = state.settings.defaultPeriod || '1d';
state.activeIndicators = new Set(state.settings.defaultIndicators || ['sma20', 'ema21']);

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}) };
  } catch { return { ...DEFAULT_SETTINGS }; }
}
function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
}
function loadFavorites() {
  try { return JSON.parse(localStorage.getItem(FAVORITES_KEY)) || []; } catch { return []; }
}
function saveFavorites() {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(state.favorites));
}

// ----------------------------------------------------------------------------------------------
// Formatação
// ----------------------------------------------------------------------------------------------

/**
 * Preço com casas decimais adaptativas. Usa as "Casas decimais" da configuração como piso, mas
 * aumenta automaticamente para valores menores que $1 — necessário para memecoins, que costumam
 * valer frações minúsculas de centavo (ex: $0,00000734). Sem isso, qualquer preço abaixo de 1
 * apareceria arredondado para "$0,00" com a config padrão (2 casas).
 */
function fmtPrice(value) {
  if (value === null || value === undefined || isNaN(value)) return '--';
  const symbol = CURRENCY_SYMBOL[state.settings.currency] || '';
  const abs = Math.abs(value);
  let decimals = state.settings.decimals;
  if (abs > 0 && abs < 1) {
    const magnitude = Math.floor(Math.log10(abs));
    decimals = Math.max(decimals, Math.min(10, -magnitude + 3));
  }
  return `${symbol}${Number(value).toLocaleString('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

function fmtPercent(value) {
  if (value === null || value === undefined || isNaN(value)) return '--';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}
function fmtCompact(value) {
  if (value === null || value === undefined || isNaN(value)) return '--';
  const symbol = CURRENCY_SYMBOL[state.settings.currency] || '';
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${symbol}${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${symbol}${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${symbol}${(value / 1e3).toFixed(2)}K`;
  return `${symbol}${value.toFixed(2)}`;
}
function fmtTime(date = new Date()) {
  if (state.settings.hourFormat === '12h') {
    return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  }
  return date.toLocaleTimeString('pt-BR', { hour12: false });
}
function fmtDateTime(ts) {
  const d = new Date(ts);
  return { date: d.toLocaleDateString('pt-BR'), time: fmtTime(d) };
}

// ----------------------------------------------------------------------------------------------
// Toasts
// ----------------------------------------------------------------------------------------------

function showToast(type, message, duration = 4000) {
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

// ----------------------------------------------------------------------------------------------
// Som (Web Audio API — sem arquivos externos) e notificações do navegador
// ----------------------------------------------------------------------------------------------

let audioCtx = null;
function playBeep() {
  if (!state.settings.sounds) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.value = Math.max(0, Math.min(1, state.settings.volume / 100)) * 0.2;
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.18);
  } catch (e) { /* Web Audio indisponível — ignora silenciosamente */ }
}

function requestNotificationPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
}
function showBrowserNotification(title, body) {
  if (!state.settings.notifications) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try { new Notification(title, { body, icon: undefined }); } catch (e) {}
}

// ----------------------------------------------------------------------------------------------
// Modo Demo (dados simulados) — usado manualmente ou como fallback automático se a API falhar
// ----------------------------------------------------------------------------------------------

const demoBase = {};
CRYPTO_LIST.forEach((c, i) => { demoBase[c.id] = 100 * (i + 1) * 3.7 + 50; });
// Memecoins costumam valer frações de centavo — semente bem menor para o modo demo não mostrar
// preços absurdos (ex: "$1.234,56" para uma moeda que na vida real vale $0,000012).
MEMECOIN_LIST.forEach((c, i) => { demoBase[c.id] = 0.000001 * (i + 1) * 137 + 0.0001; });

function isDemoActive() { return state.demoManual || state.demoAuto; }

function generateDemoMarkets(ids) {
  return ids.map((id) => {
    const base = demoBase[id];
    const wiggle = (Math.random() - 0.5) * base * 0.02;
    // Piso proporcional ao próprio preço-base (não um valor fixo como "$0,01"): esse fixo fazia
    // sentido pras 10 criptos principais, mas achatava TODAS as memecoins (que valem frações bem
    // menores) para o mesmo valor no primeiro refresh.
    demoBase[id] = Math.max(base * 0.5, base + wiggle);
    const price = demoBase[id];
    const change = (Math.random() - 0.5) * 10;
    return {
      id,
      symbol: (CRYPTO_BY_ID[id] || MEMECOIN_BY_ID[id])?.symbol.toLowerCase() || id,
      name: (CRYPTO_BY_ID[id] || MEMECOIN_BY_ID[id])?.name || id,
      current_price: price,
      price_change_percentage_24h: change,
      high_24h: price * 1.03,
      low_24h: price * 0.97,
      total_volume: price * 1_000_000 * (0.5 + Math.random()),
      market_cap: price * 19_000_000,
    };
  });
}

function generateDemoSeries(id, length = 260) {
  let price = demoBase[id] || 1000;
  const closes = [];
  const volumes = [];
  for (let i = 0; i < length; i++) {
    price = Math.max(0.01, price + (Math.random() - 0.5) * price * 0.015);
    closes.push(price);
    volumes.push(price * 1000 * (0.5 + Math.random()));
  }
  return { closes, volumes };
}

function generateDemoCandles(id, count = 150) {
  let price = demoBase[id] || 1000;
  const now = Math.floor(Date.now() / 1000);
  const step = 3600;
  const candles = [];
  for (let i = count; i >= 0; i--) {
    const open = price;
    price = Math.max(0.01, price + (Math.random() - 0.5) * price * 0.02);
    const close = price;
    const high = Math.max(open, close) * (1 + Math.random() * 0.005);
    const low = Math.min(open, close) * (1 - Math.random() * 0.005);
    candles.push({ time: now - i * step, open, high, low, close, volume: price * 1000 * Math.random() });
  }
  return candles;
}

function setDemoBanner(visible) {
  document.getElementById('demoModeBanner').classList.toggle('hidden', !visible);
}

// ----------------------------------------------------------------------------------------------
// Camada de dados segura (com fallback para modo demo em caso de falha da API)
// ----------------------------------------------------------------------------------------------

function setApiStatus(ok) {
  const dot = document.getElementById('apiStatus');
  dot.classList.remove('status-ok', 'status-error', 'status-unknown');
  dot.classList.add(ok ? 'status-ok' : 'status-error');
}

async function fetchMarketsSafe(ids) {
  if (state.demoManual) return generateDemoMarkets(ids);
  try {
    const data = await CryptoAPI.getMarkets(ids, state.settings.currency);
    setApiStatus(true);
    if (state.demoAuto) { state.demoAuto = false; setDemoBanner(state.demoManual); }
    return data;
  } catch (err) {
    console.error('Falha ao buscar mercados:', err);
    setApiStatus(false);
    if (!state.demoAuto) showToast('error', 'Falha ao conectar à API da CoinGecko. Ativando modo demo.');
    state.demoAuto = true;
    setDemoBanner(true);
    return generateDemoMarkets(ids);
  }
}

async function fetchDailySeriesSafe(id) {
  if (isDemoActive()) return generateDemoSeries(id);
  try {
    return await CryptoAPI.getDailySeries(id, state.settings.currency);
  } catch (err) {
    console.error('Falha ao buscar série diária:', err);
    return generateDemoSeries(id);
  }
}

async function fetchCandlesSafe(id, timeframe) {
  if (isDemoActive()) return generateDemoCandles(id);
  try {
    const candles = await CryptoAPI.getCandles(id, state.settings.currency, timeframe);
    if (!candles.length) return generateDemoCandles(id);
    return candles;
  } catch (err) {
    console.error('Falha ao buscar candles:', err);
    return generateDemoCandles(id);
  }
}

// ----------------------------------------------------------------------------------------------
// Indicadores — cálculo de contexto por ativo (usado por: tabela de ativos, painel, alertas)
// ----------------------------------------------------------------------------------------------

function computeContext(market, dailySeries) {
  const closes = dailySeries.closes;
  const volumes = dailySeries.volumes;

  const sma9 = Indicators.last(Indicators.SMA(closes, 9));
  const sma20 = Indicators.last(Indicators.SMA(closes, 20));
  const sma50 = Indicators.last(Indicators.SMA(closes, 50));
  const sma200 = Indicators.last(Indicators.SMA(closes, 200));
  const ema9 = Indicators.last(Indicators.EMA(closes, 9));
  const ema21 = Indicators.last(Indicators.EMA(closes, 21));
  const rsi = Indicators.last(Indicators.RSI(closes, 14));
  const macd = Indicators.MACD(closes);
  const macdLine = Indicators.last(macd.macdLine);
  const macdSignal = Indicators.last(macd.signalLine);
  const macdHist = Indicators.last(macd.histogram);
  const bb = Indicators.BollingerBands(closes, 20, 2);
  const bbUpper = Indicators.last(bb.upper);
  const bbLower = Indicators.last(bb.lower);
  const volumeAvg = Indicators.last(Indicators.VolumeSMA(volumes, 20));

  const price = market ? market.current_price : Indicators.last(closes);
  const volume = market ? market.total_volume : Indicators.last(volumes);
  const change24h = market ? market.price_change_percentage_24h : null;

  const trend = Indicators.classifyTrend({ price, ema9, ema21, sma50, sma200, rsi, macdLine, macdSignal, volume, volumeAvg });

  return {
    price, change24h, volume, volumeAvg,
    sma9, sma20, sma50, sma200, ema9, ema21,
    rsi, macdLine, macdSignal, macdHist,
    bbUpper, bbLower,
    trendScore: trend.score, trendLabel: trend.label, trendEmoji: trend.emoji,
  };
}

// ----------------------------------------------------------------------------------------------
// Ciclo de atualização
// ----------------------------------------------------------------------------------------------

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

let isRefreshing = false;
async function refreshData() {
  // Evita rodadas sobrepostas (ex: usuário escolheu intervalo de 5s mas a rodada anterior,
  // com 10 ativos throttlados a 700ms cada, ainda está em andamento).
  if (isRefreshing) return;
  isRefreshing = true;
  try {
    await doRefresh();
  } finally {
    isRefreshing = false;
  }
}

async function doRefresh() {
  // Alertas "padrão" (preço, RSI, MACD, Bollinger, volume, tendência — tudo que não é o
  // cruzamento de médias configurável) dependem do contexto diário calculado aqui. Isso inclui
  // alertas criados para memecoins: sem incluir o cryptoId deles no loop, um alerta como
  // "PEPE preço acima de X" nunca seria avaliado. Alertas de cruzamento de médias (ma_cross_custom)
  // NÃO precisam entrar aqui — eles rodam na fila própria (evaluateCustomMACrossAlerts).
  const standardAlertAssetIds = AlertsEngine.listAlerts()
    .filter((a) => a.enabled && !AlertsEngine.isCustomCrossType(a.type))
    .map((a) => a.cryptoId);

  let ids = Array.from(new Set([...CRYPTO_LIST.map((c) => c.id), ...state.favorites, ...standardAlertAssetIds]));
  // O ativo atualmente visível no Painel vai primeiro, para que preço/stats apareçam de imediato
  // em vez de esperar a fila inteira (throttlada) de indicadores dos outros ativos.
  ids = [state.currentAssetId, ...ids.filter((id) => id !== state.currentAssetId)];

  const markets = await fetchMarketsSafe(ids);
  state.marketsById = Object.fromEntries(markets.map((m) => [m.id, m]));
  renderCurrentView(); // já mostra preço/variação/volume com os dados de mercado recém-chegados
  updateChart(); // busca os candles do ativo em destaque uma única vez por ciclo (não a cada iteração)

  // Busca sequencial (não paralela) com um pequeno intervalo entre chamadas: a CoinGecko free tier
  // rate-limita rajadas de requisições simultâneas (o navegador reporta isso como erro de CORS,
  // pois a resposta 429 não inclui cabeçalho Access-Control-Allow-Origin — mas a causa real é
  // limite de requisições, não CORS). Buscar um ativo por vez evita cair no modo demo à toa.
  // A cada ativo processado, a view é re-renderizada (só texto/tabelas — o gráfico não é re-buscado
  // aqui) — assim os indicadores vão aparecendo progressivamente em vez de deixar a tela em branco
  // até o fim da fila inteira.
  for (const id of ids) {
    const series = await fetchDailySeriesSafe(id);
    const ctx = computeContext(state.marketsById[id], series);
    state.contextById[id] = ctx;
    const triggered = AlertsEngine.evaluate(id, ctx);
    triggered.forEach((alert) => handleAlertTriggered(alert, ctx));
    renderCurrentView();
    if (!isDemoActive()) await sleep(700);
  }

  await evaluateCustomMACrossAlerts();

  document.getElementById('lastUpdate').textContent = `Última atualização: ${fmtTime()}`;
  renderCurrentView();
}

/** Últimos dois valores não-nulos de uma série de indicador (penúltimo, último). */
function lastTwo(series) {
  const vals = series.filter((v) => v !== null && v !== undefined);
  return [vals.length >= 2 ? vals[vals.length - 2] : null, vals.length >= 1 ? vals[vals.length - 1] : null];
}

/**
 * Avalia os alertas de "Cruzamento de médias (configurável)" — cada um tem seu próprio
 * timeframe e período de médias, escolhidos livremente pelo usuário (ex: EMA 7 x EMA 21 no 1H
 * para o Bitcoin). Diferente dos outros alertas (que reaproveitam o contexto diário calculado
 * no loop principal), estes exigem candles do timeframe específico escolhido — por isso rodam
 * numa fila própria, agrupando alertas que compartilham o mesmo (ativo, timeframe) para não
 * buscar os mesmos candles duas vezes, e com o mesmo throttle de 700ms para não estourar o
 * rate-limit da CoinGecko. Só roda algo aqui se o usuário tiver criado esse tipo de alerta.
 */
async function evaluateCustomMACrossAlerts() {
  const customAlerts = AlertsEngine.listAlerts().filter((a) => a.enabled && AlertsEngine.isCustomCrossType(a.type));
  if (!customAlerts.length) return;

  const groups = new Map(); // "cryptoId|timeframe" -> { cryptoId, timeframe, alerts: [] }
  customAlerts.forEach((a) => {
    const key = `${a.cryptoId}|${a.timeframe}`;
    if (!groups.has(key)) groups.set(key, { cryptoId: a.cryptoId, timeframe: a.timeframe, alerts: [] });
    groups.get(key).alerts.push(a);
  });

  for (const { cryptoId, timeframe, alerts: groupAlerts } of groups.values()) {
    const candles = await fetchCandlesSafe(cryptoId, timeframe);
    if (candles.length) {
      const closes = candles.map((c) => c.close);
      const price = closes[closes.length - 1];

      groupAlerts.forEach((alert) => {
        const seriesA = alert.maA.type === 'ema' ? Indicators.EMA(closes, alert.maA.period) : Indicators.SMA(closes, alert.maA.period);
        const seriesB = alert.maB.type === 'ema' ? Indicators.EMA(closes, alert.maB.period) : Indicators.SMA(closes, alert.maB.period);
        const [prevA, curA] = lastTwo(seriesA);
        const [prevB, curB] = lastTwo(seriesB);
        const didTrigger = AlertsEngine.checkCustomCrossover(alert, prevA, curA, prevB, curB, price);
        if (didTrigger) handleAlertTriggered(alert, { price });
      });
    }
    if (!isDemoActive()) await sleep(700);
  }
}

function handleAlertTriggered(alert, ctx) {
  const asset = ALL_COINS_BY_ID[alert.cryptoId];
  const meta = AlertsEngine.typeMeta(alert.type);
  const title = `🔔 ${asset ? asset.name : alert.cryptoId}`;
  const body = alert.message || (meta ? meta.label : alert.type);
  showToast('warning', `${title}: ${body}`);
  showBrowserNotification(title, body);
  playBeep();
}

function startPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(refreshData, state.settings.interval);
}

// ----------------------------------------------------------------------------------------------
// Navegação entre views
// ----------------------------------------------------------------------------------------------

function switchView(view) {
  state.currentView = view;
  document.querySelectorAll('.view').forEach((el) => el.classList.remove('active'));
  document.getElementById(`view-${view}`).classList.add('active');
  document.querySelectorAll('.nav-item').forEach((el) => el.classList.toggle('active', el.dataset.view === view));
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.add('hidden');
  renderCurrentView();
  if (view === 'memecoins' && !state.memecoinsLoaded && !state.memecoinsLoading) loadMemecoins();
}

/** Troca o ativo em destaque no Painel e busca o gráfico dele (chamado a partir de outras views). */
function showAsset(id) {
  state.currentAssetId = id;
  switchView('dashboard');
  document.getElementById('assetSelect').value = id;
  updateChart();
}

function renderCurrentView() {
  switch (state.currentView) {
    case 'dashboard': renderDashboard(); break;
    case 'assets': renderAssetsTable(); break;
    case 'memecoins': renderMemecoins(); break;
    case 'favorites': renderFavorites(); break;
    case 'alerts': renderAlerts(); break;
    case 'history': renderHistory(); break;
    case 'settings': break; // estático, populado no init
  }
}

// ----------------------------------------------------------------------------------------------
// Dashboard: gráfico + painel de ativo + cards de indicadores
// ----------------------------------------------------------------------------------------------

function initChart() {
  const el = document.getElementById('priceChart');
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  state.chart = LightweightCharts.createChart(el, {
    layout: {
      background: { color: 'transparent' },
      textColor: isDark ? '#8b93a8' : '#5a6377',
    },
    grid: {
      vertLines: { color: isDark ? '#2a3450' : '#dde3ef' },
      horzLines: { color: isDark ? '#2a3450' : '#dde3ef' },
    },
    timeScale: { timeVisible: true, secondsVisible: false },
    autoSize: true,
  });
  state.candleSeries = state.chart.addCandlestickSeries({
    upColor: '#43a047', downColor: '#e53935',
    borderUpColor: '#43a047', borderDownColor: '#e53935',
    wickUpColor: '#43a047', wickDownColor: '#e53935',
  });
  state.volumeSeries = state.chart.addHistogramSeries({
    priceFormat: { type: 'volume' },
    priceScaleId: '',
    color: '#1e88e544',
  });
  state.volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
}

const OVERLAY_COLORS = { sma9: '#fb8c00', sma20: '#1e88e5', sma50: '#8e24aa', ema21: '#43a047' };

async function updateChart() {
  const id = state.currentAssetId;
  const candles = await fetchCandlesSafe(id, state.currentTimeframe);
  if (!candles.length) return;

  state.candleSeries.setData(candles.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close })));
  state.volumeSeries.setData(candles.map((c) => ({ time: c.time, value: c.volume, color: c.close >= c.open ? '#43a04766' : '#e5393566' })));

  const closes = candles.map((c) => c.close);
  const overlayData = {
    sma9: Indicators.SMA(closes, 9),
    sma20: Indicators.SMA(closes, 20),
    sma50: Indicators.SMA(closes, 50),
    ema21: Indicators.EMA(closes, 21),
  };

  Object.entries(overlayData).forEach(([key, series]) => {
    if (!state.overlaySeries[key]) {
      state.overlaySeries[key] = state.chart.addLineSeries({ color: OVERLAY_COLORS[key], lineWidth: 2, priceLineVisible: false });
    }
    const visible = state.activeIndicators.has(key);
    state.overlaySeries[key].applyOptions({ visible });
    if (visible) {
      const data = candles
        .map((c, i) => ({ time: c.time, value: series[i] }))
        .filter((p) => p.value !== null && p.value !== undefined);
      state.overlaySeries[key].setData(data);
    }
  });

  state.chart.timeScale().fitContent();
}

function renderDashboard() {
  const id = state.currentAssetId;
  const market = state.marketsById[id];
  const ctx = state.contextById[id];
  const asset = CRYPTO_BY_ID[id];
  if (!asset) return;

  document.getElementById('assetName').textContent = `${asset.name} (${asset.symbol})`;
  document.getElementById('assetPrice').textContent = market ? fmtPrice(market.current_price) : '--';

  const changeEl = document.getElementById('assetChange');
  const change = market ? market.price_change_percentage_24h : null;
  changeEl.textContent = fmtPercent(change);
  changeEl.className = 'asset-change ' + (change > 0 ? 'up' : change < 0 ? 'down' : '');

  document.getElementById('statHigh').textContent = market ? fmtPrice(market.high_24h) : '--';
  document.getElementById('statLow').textContent = market ? fmtPrice(market.low_24h) : '--';
  document.getElementById('statVolume').textContent = market ? fmtCompact(market.total_volume) : '--';
  document.getElementById('statMcap').textContent = market ? fmtCompact(market.market_cap) : '--';

  const favBtn = document.getElementById('favToggleBtn');
  const isFav = state.favorites.includes(id);
  favBtn.textContent = isFav ? '★ Remover dos favoritos' : '☆ Adicionar aos favoritos';
  favBtn.classList.toggle('btn-primary', isFav);
  favBtn.classList.toggle('btn-outline', !isFav);

  if (ctx) {
    document.getElementById('rsiValue').textContent = ctx.rsi !== null ? ctx.rsi.toFixed(1) : '--';
    document.getElementById('rsiZone').textContent = ctx.rsi === null ? '--' : ctx.rsi >= 70 ? 'Sobrecompra' : ctx.rsi <= 30 ? 'Sobrevenda' : 'Neutro';

    document.getElementById('macdValue').textContent = ctx.macdLine !== null ? ctx.macdLine.toFixed(4) : '--';
    document.getElementById('macdSignalDesc').textContent = ctx.macdLine !== null && ctx.macdSignal !== null
      ? (ctx.macdLine > ctx.macdSignal ? 'Acima do sinal (bullish)' : 'Abaixo do sinal (bearish)') : '--';

    document.getElementById('bbValue').textContent = ctx.bbUpper !== null ? `${fmtPrice(ctx.bbLower)} — ${fmtPrice(ctx.bbUpper)}` : '--';
    document.getElementById('bbPosition').textContent = (ctx.price !== null && ctx.bbUpper !== null)
      ? (ctx.price > ctx.bbUpper ? 'Acima da banda superior' : ctx.price < ctx.bbLower ? 'Abaixo da banda inferior' : 'Dentro das bandas') : '--';

    document.getElementById('volValue').textContent = ctx.volume !== null ? fmtCompact(ctx.volume) : '--';
    document.getElementById('volVsAvg').textContent = (ctx.volume !== null && ctx.volumeAvg)
      ? (ctx.volume > ctx.volumeAvg ? '⬆ Acima da média' : '⬇ Abaixo da média') : '--';

    document.getElementById('trendValue').textContent = `${ctx.trendEmoji} ${ctx.trendLabel}`;

    document.getElementById('distEma21').textContent = distanceStr(ctx.price, ctx.ema21);
    document.getElementById('distSma50').textContent = distanceStr(ctx.price, ctx.sma50);
    document.getElementById('distSma200').textContent = distanceStr(ctx.price, ctx.sma200);
  }
}

function distanceStr(price, ma) {
  if (price === null || ma === null || ma === undefined || !ma) return '--';
  const pct = ((price - ma) / ma) * 100;
  return `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

function populateAssetSelect() {
  const select = document.getElementById('assetSelect');
  select.innerHTML = CRYPTO_LIST.map((c) => `<option value="${c.id}">${c.name} (${c.symbol})</option>`).join('');
  select.value = state.currentAssetId;
}

// ----------------------------------------------------------------------------------------------
// View: Ativos
// ----------------------------------------------------------------------------------------------

function renderAssetsTable() {
  const search = (document.getElementById('assetSearch').value || '').toLowerCase();
  let rows = CRYPTO_LIST.filter((c) => c.name.toLowerCase().includes(search) || c.symbol.toLowerCase().includes(search));

  rows = rows.map((c) => {
    const m = state.marketsById[c.id];
    const ctx = state.contextById[c.id];
    return {
      ...c,
      price: m ? m.current_price : null,
      change: m ? m.price_change_percentage_24h : null,
      volume: m ? m.total_volume : null,
      rsi: ctx ? ctx.rsi : null,
      trend: ctx ? `${ctx.trendEmoji} ${ctx.trendLabel}` : '--',
    };
  });

  const { key, dir } = state.sortState;
  rows.sort((a, b) => {
    let av = a[key], bv = b[key];
    if (typeof av === 'string') return av.localeCompare(bv) * dir;
    av = av ?? -Infinity; bv = bv ?? -Infinity;
    return (av - bv) * dir;
  });

  const tbody = document.getElementById('assetsTableBody');
  tbody.innerHTML = rows.map((r) => {
    const isFav = state.favorites.includes(r.id);
    return `<tr>
      <td><button class="star-btn ${isFav ? 'active' : ''}" data-fav-toggle="${r.id}">${isFav ? '★' : '☆'}</button></td>
      <td>${r.name}</td>
      <td>${r.symbol}</td>
      <td>${fmtPrice(r.price)}</td>
      <td class="${r.change > 0 ? 'asset-change up' : r.change < 0 ? 'asset-change down' : ''}">${fmtPercent(r.change)}</td>
      <td>${fmtCompact(r.volume)}</td>
      <td>${r.rsi !== null ? r.rsi.toFixed(1) : '--'}</td>
      <td>${r.trend}</td>
      <td><button class="btn btn-outline" data-view-asset="${r.id}">Ver</button></td>
    </tr>`;
  }).join('') || `<tr><td colspan="9" class="empty-state">Nenhum ativo encontrado.</td></tr>`;
}

// ----------------------------------------------------------------------------------------------
// View: Memecoins (carregada sob demanda — ver comentário em MEMECOIN_LIST)
// ----------------------------------------------------------------------------------------------

/** Busca os dados de mercado de todas as memecoins em UMA única chamada (a lista tem <= 250 ids). */
async function loadMemecoins() {
  if (state.memecoinsLoading) return;
  state.memecoinsLoading = true;
  renderMemecoins();

  const ids = MEMECOIN_LIST.map((c) => c.id);
  try {
    const markets = isDemoActive() ? generateDemoMarkets(ids) : await CryptoAPI.getMarkets(ids, state.settings.currency);
    state.memecoinsById = Object.fromEntries(markets.map((m) => [m.id, m]));
    state.memecoinsLoaded = true;
    document.getElementById('memecoinsLastUpdate').textContent = fmtTime();
  } catch (err) {
    console.error('Falha ao buscar memecoins:', err);
    showToast('error', 'Falha ao carregar memecoins. Tente novamente em instantes.');
  } finally {
    state.memecoinsLoading = false;
    renderMemecoins();
  }
}

function renderMemecoins() {
  const loadingEl = document.getElementById('memecoinsLoading');
  const emptyEl = document.getElementById('memecoinsEmpty');
  loadingEl.classList.toggle('hidden', !state.memecoinsLoading);

  const search = (document.getElementById('memecoinSearch').value || '').toLowerCase();
  let rows = MEMECOIN_LIST.filter((c) => c.name.toLowerCase().includes(search) || c.symbol.toLowerCase().includes(search));

  rows = rows.map((c) => {
    const m = state.memecoinsById[c.id];
    return {
      ...c,
      price: m ? m.current_price : null,
      change: m ? m.price_change_percentage_24h : null,
      high: m ? m.high_24h : null,
      low: m ? m.low_24h : null,
      volume: m ? m.total_volume : null,
      mcap: m ? m.market_cap : null,
      found: !!m,
    };
  });

  // Memecoins cujo id não retornou na API (ex: token renomeado/deslistado) ficam de fora da
  // tabela em vez de aparecer com "--" em tudo — mais honesto do que fingir que temos o dado.
  if (state.memecoinsLoaded) rows = rows.filter((r) => r.found);

  const { key, dir } = state.memecoinsSortState;
  rows.sort((a, b) => {
    let av = a[key], bv = b[key];
    if (typeof av === 'string') return av.localeCompare(bv) * dir;
    av = av ?? -Infinity; bv = bv ?? -Infinity;
    return (av - bv) * dir;
  });

  const tbody = document.getElementById('memecoinsTableBody');
  tbody.innerHTML = rows.map((r) => `<tr>
      <td>${r.name}</td>
      <td>${r.symbol}</td>
      <td>${fmtPrice(r.price)}</td>
      <td class="${r.change > 0 ? 'asset-change up' : r.change < 0 ? 'asset-change down' : ''}">${fmtPercent(r.change)}</td>
      <td>${fmtPrice(r.high)}</td>
      <td>${fmtPrice(r.low)}</td>
      <td>${fmtCompact(r.volume)}</td>
      <td>${fmtCompact(r.mcap)}</td>
    </tr>`).join('');

  emptyEl.classList.toggle('hidden', !(state.memecoinsLoaded && !state.memecoinsLoading && rows.length === 0));
}

// ----------------------------------------------------------------------------------------------
// View: Favoritos
// ----------------------------------------------------------------------------------------------

function renderFavorites() {
  const grid = document.getElementById('favoritesGrid');
  if (!state.favorites.length) {
    grid.innerHTML = `<p class="empty-state">Nenhum favorito ainda. Adicione ativos pelo Painel ou pela lista de Ativos.</p>`;
    return;
  }
  grid.innerHTML = state.favorites.map((id) => {
    const asset = CRYPTO_BY_ID[id];
    const m = state.marketsById[id];
    const ctx = state.contextById[id];
    if (!asset) return '';
    const change = m ? m.price_change_percentage_24h : null;
    return `<div class="fav-card" data-view-asset="${id}">
      <div class="fav-card-head">
        <strong>${asset.name}</strong>
        <button class="fav-remove" data-fav-toggle="${id}" title="Remover">✕</button>
      </div>
      <div class="fav-card-price">${m ? fmtPrice(m.current_price) : '--'}</div>
      <div class="fav-card-row"><span>Variação 24h</span><span class="${change > 0 ? 'asset-change up' : change < 0 ? 'asset-change down' : ''}">${fmtPercent(change)}</span></div>
      <div class="fav-card-row"><span>RSI</span><span>${ctx && ctx.rsi !== null ? ctx.rsi.toFixed(1) : '--'}</span></div>
      <div class="fav-card-row"><span>Tendência</span><span>${ctx ? ctx.trendEmoji + ' ' + ctx.trendLabel : '--'}</span></div>
    </div>`;
  }).join('');
}

function toggleFavorite(id) {
  const idx = state.favorites.indexOf(id);
  if (idx === -1) { state.favorites.push(id); showToast('success', `${CRYPTO_BY_ID[id]?.name} adicionado aos favoritos.`); }
  else { state.favorites.splice(idx, 1); showToast('success', `${CRYPTO_BY_ID[id]?.name} removido dos favoritos.`); }
  saveFavorites();
  renderCurrentView();
  if (state.currentView === 'dashboard') renderDashboard();
}

// ----------------------------------------------------------------------------------------------
// View: Alertas
// ----------------------------------------------------------------------------------------------

function populateAlertForm() {
  const assetSelect = document.getElementById('alertAsset');
  const mainOptions = CRYPTO_LIST.map((c) => `<option value="${c.id}">${c.name} (${c.symbol})</option>`).join('');
  const memeOptions = MEMECOIN_LIST.map((c) => `<option value="${c.id}">${c.name} (${c.symbol})</option>`).join('');
  assetSelect.innerHTML = `<optgroup label="Principais">${mainOptions}</optgroup><optgroup label="Memecoins">${memeOptions}</optgroup>`;

  const typeSelect = document.getElementById('alertType');
  const byCategory = {};
  AlertsEngine.ALERT_TYPES.forEach((t) => { (byCategory[t.category] ||= []).push(t); });
  typeSelect.innerHTML = Object.entries(byCategory).map(([cat, types]) =>
    `<optgroup label="${cat}">${types.map((t) => `<option value="${t.value}">${t.label}</option>`).join('')}</optgroup>`
  ).join('');

  updateAlertFormVisibility();
}

function updateAlertFormVisibility() {
  const type = document.getElementById('alertType').value;
  const meta = AlertsEngine.typeMeta(type);
  document.getElementById('alertValueWrap').classList.toggle('hidden', !(meta && meta.needsValue));
  const isMA = !!(meta && meta.needsMAConfig);
  document.getElementById('alertTimeframeWrap').classList.toggle('hidden', !isMA);
  document.getElementById('alertMaAWrap').classList.toggle('hidden', !isMA);
  document.getElementById('alertMaBWrap').classList.toggle('hidden', !isMA);
}

function renderAlerts() {
  const alerts = AlertsEngine.listAlerts();
  const tbody = document.getElementById('alertsTableBody');
  document.getElementById('alertsEmpty').classList.toggle('hidden', alerts.length > 0);

  tbody.innerHTML = alerts.map((a) => {
    const asset = ALL_COINS_BY_ID[a.cryptoId];
    const meta = AlertsEngine.typeMeta(a.type);
    return `<tr>
      <td>${asset ? asset.name : a.cryptoId}</td>
      <td>${meta ? meta.category : '--'}</td>
      <td>${AlertsEngine.describeAlert(a)}</td>
      <td>${a.cooldown}</td>
      <td><span class="badge ${a.enabled ? 'badge-on' : 'badge-off'}" data-alert-toggle="${a.id}" style="cursor:pointer">${a.enabled ? 'Ativo' : 'Pausado'}</span></td>
      <td><button class="btn btn-danger" data-alert-delete="${a.id}">Excluir</button></td>
    </tr>`;
  }).join('');
}

// ----------------------------------------------------------------------------------------------
// View: Histórico
// ----------------------------------------------------------------------------------------------

function populateHistoryFilter() {
  const select = document.getElementById('historyAssetFilter');
  const mainOptions = CRYPTO_LIST.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
  const memeOptions = MEMECOIN_LIST.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
  select.innerHTML = `<option value="">Todos os ativos</option><optgroup label="Principais">${mainOptions}</optgroup><optgroup label="Memecoins">${memeOptions}</optgroup>`;
}

function renderHistory() {
  const cryptoId = document.getElementById('historyAssetFilter').value || null;
  const date = document.getElementById('historyDateFilter').value || null;
  const rows = AlertsEngine.getHistory({ cryptoId, date });

  document.getElementById('historyEmpty').classList.toggle('hidden', rows.length > 0);
  document.getElementById('historyTableBody').innerHTML = rows.map((h) => {
    const { date, time } = fmtDateTime(h.timestamp);
    const asset = ALL_COINS_BY_ID[h.cryptoId];
    return `<tr>
      <td>${date}</td><td>${time}</td><td>${asset ? asset.name : h.cryptoId}</td>
      <td>${h.type}</td><td>${h.typeLabel}</td><td>${h.price !== null ? fmtPrice(h.price) : '--'}</td><td>${h.message}</td>
    </tr>`;
  }).join('');
}

// ----------------------------------------------------------------------------------------------
// View: Configurações
// ----------------------------------------------------------------------------------------------

function populateSettingsForm() {
  const s = state.settings;
  document.getElementById('cfgCurrency').value = s.currency;
  document.getElementById('cfgInterval').value = String(s.interval);
  document.getElementById('cfgHourFormat').value = s.hourFormat;
  document.getElementById('cfgDecimals').value = s.decimals;
  document.getElementById('cfgTheme').value = s.theme;
  document.getElementById('cfgDefaultPeriod').value = s.defaultPeriod;
  document.getElementById('cfgNotifications').checked = s.notifications;
  document.getElementById('cfgSounds').checked = s.sounds;
  document.getElementById('cfgVolume').value = s.volume;
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('themeBtn').textContent = theme === 'dark' ? '🌙' : '☀️';
  if (state.chart) {
    const isDark = theme !== 'light';
    state.chart.applyOptions({
      layout: { textColor: isDark ? '#8b93a8' : '#5a6377' },
      grid: {
        vertLines: { color: isDark ? '#2a3450' : '#dde3ef' },
        horzLines: { color: isDark ? '#2a3450' : '#dde3ef' },
      },
    });
  }
}

// ----------------------------------------------------------------------------------------------
// Event wiring
// ----------------------------------------------------------------------------------------------

function wireEvents() {
  // Sidebar / navegação
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });
  document.getElementById('menuToggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebarOverlay').classList.toggle('hidden');
  });
  document.getElementById('sidebarOverlay').addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarOverlay').classList.add('hidden');
  });

  // Header
  document.getElementById('refreshBtn').addEventListener('click', () => { refreshData(); showToast('success', 'Atualizando dados...'); });
  document.getElementById('soundBtn').addEventListener('click', () => {
    state.settings.sounds = !state.settings.sounds;
    saveSettings();
    document.getElementById('soundBtn').textContent = state.settings.sounds ? '🔊' : '🔇';
    document.getElementById('cfgSounds').checked = state.settings.sounds;
  });
  document.getElementById('themeBtn').addEventListener('click', () => {
    state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark';
    saveSettings();
    applyTheme(state.settings.theme);
    document.getElementById('cfgTheme').value = state.settings.theme;
  });

  // Dashboard
  document.getElementById('assetSelect').addEventListener('change', (e) => {
    state.currentAssetId = e.target.value;
    renderDashboard();
    updateChart();
  });
  document.getElementById('timeframePicker').addEventListener('click', (e) => {
    const btn = e.target.closest('.tf-btn');
    if (!btn) return;
    document.querySelectorAll('.tf-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.currentTimeframe = btn.dataset.tf;
    updateChart();
  });
  document.getElementById('indicatorToggles').addEventListener('change', (e) => {
    const cb = e.target.closest('input[data-ind]');
    if (!cb) return;
    if (cb.checked) state.activeIndicators.add(cb.dataset.ind);
    else state.activeIndicators.delete(cb.dataset.ind);
    updateChart();
  });
  document.getElementById('favToggleBtn').addEventListener('click', () => toggleFavorite(state.currentAssetId));

  // Ativos
  document.getElementById('assetSearch').addEventListener('input', renderAssetsTable);
  document.getElementById('assetsTable').querySelector('thead').addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (!th) return;
    const key = th.dataset.sort;
    state.sortState.dir = state.sortState.key === key ? -state.sortState.dir : 1;
    state.sortState.key = key;
    renderAssetsTable();
  });
  document.getElementById('assetsTableBody').addEventListener('click', (e) => {
    const favBtn = e.target.closest('[data-fav-toggle]');
    const viewBtn = e.target.closest('[data-view-asset]');
    if (favBtn) toggleFavorite(favBtn.dataset.favToggle);
    else if (viewBtn) showAsset(viewBtn.dataset.viewAsset);
  });

  // Memecoins
  document.getElementById('memecoinSearch').addEventListener('input', renderMemecoins);
  document.getElementById('memecoinsRefreshBtn').addEventListener('click', () => loadMemecoins());
  document.getElementById('memecoinsTable').querySelector('thead').addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (!th) return;
    const key = th.dataset.sort;
    state.memecoinsSortState.dir = state.memecoinsSortState.key === key ? -state.memecoinsSortState.dir : 1;
    state.memecoinsSortState.key = key;
    renderMemecoins();
  });

  // Favoritos
  document.getElementById('favoritesGrid').addEventListener('click', (e) => {
    const removeBtn = e.target.closest('[data-fav-toggle]');
    const card = e.target.closest('[data-view-asset]');
    if (removeBtn) { toggleFavorite(removeBtn.dataset.favToggle); }
    else if (card) showAsset(card.dataset.viewAsset);
  });

  // Alertas
  document.getElementById('newAlertBtn').addEventListener('click', () => {
    document.getElementById('alertFormPanel').classList.toggle('hidden');
  });
  document.getElementById('cancelAlertBtn').addEventListener('click', () => {
    document.getElementById('alertFormPanel').classList.add('hidden');
  });
  document.getElementById('alertType').addEventListener('change', updateAlertFormVisibility);
  document.getElementById('saveAlertBtn').addEventListener('click', () => {
    const assetSelect = document.getElementById('alertAsset');
    const selectedAssets = Array.from(assetSelect.selectedOptions).map((o) => o.value);
    if (!selectedAssets.length) { showToast('error', 'Selecione ao menos uma moeda.'); return; }

    const type = document.getElementById('alertType').value;
    const meta = AlertsEngine.typeMeta(type);
    const value = document.getElementById('alertValue').value;
    const cooldown = document.getElementById('alertCooldown').value;
    const message = document.getElementById('alertMessage').value;
    const maConfig = meta && meta.needsMAConfig ? {
      timeframe: document.getElementById('alertTimeframe').value,
      maAType: document.getElementById('alertMaAType').value,
      maAPeriod: document.getElementById('alertMaAPeriod').value,
      maBType: document.getElementById('alertMaBType').value,
      maBPeriod: document.getElementById('alertMaBPeriod').value,
    } : {};

    selectedAssets.forEach((cryptoId) => {
      AlertsEngine.createAlert({ cryptoId, type, value, cooldown, message, ...maConfig });
    });

    document.getElementById('alertFormPanel').classList.add('hidden');
    document.getElementById('alertValue').value = '';
    document.getElementById('alertMessage').value = '';
    showToast('success', `${selectedAssets.length} alerta(s) criado(s) com sucesso.`);
    renderAlerts();
  });
  document.getElementById('alertsTableBody').addEventListener('click', (e) => {
    const toggleEl = e.target.closest('[data-alert-toggle]');
    const deleteBtn = e.target.closest('[data-alert-delete]');
    if (toggleEl) { AlertsEngine.toggleAlert(toggleEl.dataset.alertToggle); renderAlerts(); }
    else if (deleteBtn) { AlertsEngine.deleteAlert(deleteBtn.dataset.alertDelete); renderAlerts(); showToast('success', 'Alerta excluído.'); }
  });

  // Histórico
  document.getElementById('historyAssetFilter').addEventListener('change', renderHistory);
  document.getElementById('historyDateFilter').addEventListener('change', renderHistory);
  document.getElementById('exportCsvBtn').addEventListener('click', () => {
    const csv = AlertsEngine.exportHistoryCSV();
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'crypto_monitor_historico.csv';
    a.click();
    URL.revokeObjectURL(url);
  });
  document.getElementById('clearHistoryBtn').addEventListener('click', () => {
    if (!confirm('Limpar todo o histórico de alertas disparados?')) return;
    AlertsEngine.clearHistory();
    renderHistory();
    showToast('success', 'Histórico limpo.');
  });

  // Configurações
  document.getElementById('cfgCurrency').addEventListener('change', (e) => { state.settings.currency = e.target.value; saveSettings(); refreshData(); });
  document.getElementById('cfgInterval').addEventListener('change', (e) => { state.settings.interval = Number(e.target.value); saveSettings(); startPolling(); });
  document.getElementById('cfgHourFormat').addEventListener('change', (e) => { state.settings.hourFormat = e.target.value; saveSettings(); });
  document.getElementById('cfgDecimals').addEventListener('change', (e) => { state.settings.decimals = Number(e.target.value); saveSettings(); renderCurrentView(); });
  document.getElementById('cfgTheme').addEventListener('change', (e) => { state.settings.theme = e.target.value; saveSettings(); applyTheme(e.target.value); });
  document.getElementById('cfgDefaultPeriod').addEventListener('change', (e) => { state.settings.defaultPeriod = e.target.value; saveSettings(); });
  document.getElementById('cfgNotifications').addEventListener('change', (e) => {
    state.settings.notifications = e.target.checked; saveSettings();
    if (e.target.checked) requestNotificationPermission();
  });
  document.getElementById('cfgSounds').addEventListener('change', (e) => {
    state.settings.sounds = e.target.checked; saveSettings();
    document.getElementById('soundBtn').textContent = e.target.checked ? '🔊' : '🔇';
  });
  document.getElementById('cfgVolume').addEventListener('input', (e) => { state.settings.volume = Number(e.target.value); saveSettings(); });

  document.getElementById('exportConfigBtn').addEventListener('click', () => {
    const payload = { settings: state.settings, favorites: state.favorites, alerts: AlertsEngine.listAlerts() };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'crypto_monitor_config.json';
    a.click();
    URL.revokeObjectURL(url);
  });
  document.getElementById('importConfigInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = JSON.parse(reader.result);
        if (payload.settings) { state.settings = { ...DEFAULT_SETTINGS, ...payload.settings }; saveSettings(); }
        if (payload.favorites) { state.favorites = payload.favorites; saveFavorites(); }
        populateSettingsForm();
        applyTheme(state.settings.theme);
        renderCurrentView();
        showToast('success', 'Configuração importada com sucesso.');
      } catch (err) {
        showToast('error', 'Arquivo de configuração inválido.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });
  document.getElementById('testAlertBtn').addEventListener('click', () => {
    handleAlertTriggered({ cryptoId: state.currentAssetId, message: 'Este é um alerta de teste 🔔' }, state.contextById[state.currentAssetId] || {});
  });
  document.getElementById('demoModeBtn').addEventListener('click', () => {
    state.demoManual = !state.demoManual;
    setDemoBanner(isDemoActive());
    showToast('success', state.demoManual ? 'Modo demo ativado.' : 'Modo demo desativado.');
    refreshData();
  });
  document.getElementById('resetAllBtn').addEventListener('click', () => {
    if (!confirm('Isso vai apagar TODOS os alertas, histórico, favoritos e configurações salvas neste navegador. Continuar?')) return;
    localStorage.removeItem(SETTINGS_KEY);
    localStorage.removeItem(FAVORITES_KEY);
    AlertsEngine.resetAll();
    state.settings = { ...DEFAULT_SETTINGS };
    state.favorites = [];
    saveSettings(); saveFavorites();
    populateSettingsForm();
    applyTheme(state.settings.theme);
    renderCurrentView();
    showToast('success', 'Todos os dados foram resetados.');
  });
}

// ----------------------------------------------------------------------------------------------
// Inicialização
// ----------------------------------------------------------------------------------------------

async function init() {
  applyTheme(state.settings.theme);
  document.getElementById('soundBtn').textContent = state.settings.sounds ? '🔊' : '🔇';

  populateAssetSelect();
  populateAlertForm();
  populateHistoryFilter();
  populateSettingsForm();
  initChart();
  wireEvents();

  document.querySelectorAll(`.tf-btn[data-tf="${state.currentTimeframe}"]`).forEach((b) => {
    document.querySelectorAll('.tf-btn').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
  });
  document.querySelectorAll(`input[data-ind]`).forEach((cb) => {
    cb.checked = state.activeIndicators.has(cb.dataset.ind);
  });

  await refreshData();
  startPolling();
}

document.addEventListener('DOMContentLoaded', init);
