/**
 * alerts.js — Sistema de alertas (26 tipos), com cooldown, histórico e persistência em LocalStorage.
 *
 * Este módulo é "burro" de propósito: não sabe nada de DOM, som ou notificações do navegador.
 * Ele só avalia condições e chama `onTrigger(alert, context)`, registrado pela app (app.js),
 * que decide como mostrar/tocar/notificar. Isso mantém a separação de responsabilidades pedida
 * na estrutura de arquivos.
 *
 * Para alertas de "cruzamento" (cross), o motor guarda o último snapshot de contexto de cada
 * ativo e compara com o snapshot atual a cada avaliação.
 */

const AlertsEngine = (() => {
  const ALERTS_KEY = 'crypto_monitor_alerts';
  const HISTORY_KEY = 'crypto_monitor_history';
  const HISTORY_LIMIT = 500;

  const COOLDOWN_MS = {
    once: null,
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '30m': 30 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000,
  };

  const ALERT_TYPES = [
    // Preço
    { value: 'price_above', label: 'Preço acima de', category: 'Preço', needsValue: true },
    { value: 'price_below', label: 'Preço abaixo de', category: 'Preço', needsValue: true },
    { value: 'price_cross_above', label: 'Preço cruza acima de', category: 'Preço', needsValue: true },
    { value: 'price_cross_below', label: 'Preço cruza abaixo de', category: 'Preço', needsValue: true },
    { value: 'change_above', label: 'Variação 24h acima de (%)', category: 'Preço', needsValue: true },
    { value: 'change_below', label: 'Variação 24h abaixo de (%)', category: 'Preço', needsValue: true },
    // Médias móveis
    { value: 'ma_cross_above', label: 'Preço cruza acima da EMA 21', category: 'Médias', needsValue: false },
    { value: 'ma_cross_below', label: 'Preço cruza abaixo da EMA 21', category: 'Médias', needsValue: false },
    { value: 'ma_ma_cross_above', label: 'Cruzamento dourado (EMA9 > SMA50)', category: 'Médias', needsValue: false },
    { value: 'ma_ma_cross_below', label: 'Cruzamento da morte (EMA9 < SMA50)', category: 'Médias', needsValue: false },
    { value: 'price_above_sma200', label: 'Preço acima da SMA 200', category: 'Médias', needsValue: false },
    { value: 'price_below_sma200', label: 'Preço abaixo da SMA 200', category: 'Médias', needsValue: false },
    // RSI
    { value: 'rsi_above', label: 'RSI acima de', category: 'RSI', needsValue: true },
    { value: 'rsi_below', label: 'RSI abaixo de', category: 'RSI', needsValue: true },
    { value: 'rsi_overbought', label: 'RSI em sobrecompra (≥ 70)', category: 'RSI', needsValue: false },
    { value: 'rsi_oversold', label: 'RSI em sobrevenda (≤ 30)', category: 'RSI', needsValue: false },
    // MACD
    { value: 'macd_cross_above', label: 'MACD cruza acima do sinal', category: 'MACD', needsValue: false },
    { value: 'macd_cross_below', label: 'MACD cruza abaixo do sinal', category: 'MACD', needsValue: false },
    { value: 'macd_hist_positive', label: 'Histograma MACD vira positivo', category: 'MACD', needsValue: false },
    { value: 'macd_hist_negative', label: 'Histograma MACD vira negativo', category: 'MACD', needsValue: false },
    // Bollinger
    { value: 'bb_break_upper', label: 'Preço rompe banda superior de Bollinger', category: 'Bollinger', needsValue: false },
    { value: 'bb_break_lower', label: 'Preço rompe banda inferior de Bollinger', category: 'Bollinger', needsValue: false },
    // Volume
    { value: 'volume_above_avg', label: 'Volume acima da média', category: 'Volume', needsValue: false },
    { value: 'volume_spike', label: 'Pico de volume (x vezes a média)', category: 'Volume', needsValue: true },
    // Tendência
    { value: 'trend_change_bullish', label: 'Tendência vira de alta', category: 'Tendência', needsValue: false },
    { value: 'trend_change_bearish', label: 'Tendência vira de baixa', category: 'Tendência', needsValue: false },
  ];

  let alerts = [];
  let history = [];
  let onTriggerCallback = null;
  const lastSnapshot = new Map(); // cryptoId -> context

  function load() {
    try {
      alerts = JSON.parse(localStorage.getItem(ALERTS_KEY)) || [];
    } catch { alerts = []; }
    try {
      history = JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
    } catch { history = []; }
  }

  function saveAlerts() {
    localStorage.setItem(ALERTS_KEY, JSON.stringify(alerts));
  }

  function saveHistory() {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  }

  function onTrigger(fn) {
    onTriggerCallback = fn;
  }

  function listAlerts(cryptoId = null) {
    return cryptoId ? alerts.filter((a) => a.cryptoId === cryptoId) : alerts.slice();
  }

  function createAlert(data) {
    const alert = {
      id: 'al_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      cryptoId: data.cryptoId,
      type: data.type,
      value: data.value !== undefined && data.value !== '' ? Number(data.value) : null,
      cooldown: data.cooldown || 'once',
      message: data.message || '',
      enabled: true,
      createdAt: Date.now(),
      lastTriggered: null,
    };
    alerts.push(alert);
    saveAlerts();
    return alert;
  }

  function deleteAlert(id) {
    alerts = alerts.filter((a) => a.id !== id);
    saveAlerts();
  }

  function toggleAlert(id) {
    const a = alerts.find((x) => x.id === id);
    if (a) { a.enabled = !a.enabled; saveAlerts(); }
    return a;
  }

  function isInCooldown(alert) {
    if (!alert.lastTriggered) return false;
    if (alert.cooldown === 'once') return true; // já disparou uma vez, nunca mais dispara
    const ms = COOLDOWN_MS[alert.cooldown];
    if (!ms) return false;
    return Date.now() - alert.lastTriggered < ms;
  }

  function typeMeta(type) {
    return ALERT_TYPES.find((t) => t.value === type);
  }

  function conditionMet(alert, prev, curr) {
    const v = alert.value;
    switch (alert.type) {
      case 'price_above': return curr.price !== null && curr.price > v;
      case 'price_below': return curr.price !== null && curr.price < v;
      case 'price_cross_above': return prev && prev.price !== null && curr.price !== null && prev.price <= v && curr.price > v;
      case 'price_cross_below': return prev && prev.price !== null && curr.price !== null && prev.price >= v && curr.price < v;
      case 'change_above': return curr.change24h !== null && curr.change24h > v;
      case 'change_below': return curr.change24h !== null && curr.change24h < v;

      case 'ma_cross_above': return crossUp(prev, curr, 'price', 'ema21');
      case 'ma_cross_below': return crossDown(prev, curr, 'price', 'ema21');
      case 'ma_ma_cross_above': return crossUp(prev, curr, 'ema9', 'sma50');
      case 'ma_ma_cross_below': return crossDown(prev, curr, 'ema9', 'sma50');
      case 'price_above_sma200': return curr.price !== null && curr.sma200 !== null && curr.price > curr.sma200;
      case 'price_below_sma200': return curr.price !== null && curr.sma200 !== null && curr.price < curr.sma200;

      case 'rsi_above': return curr.rsi !== null && curr.rsi > v;
      case 'rsi_below': return curr.rsi !== null && curr.rsi < v;
      case 'rsi_overbought': return curr.rsi !== null && curr.rsi >= 70;
      case 'rsi_oversold': return curr.rsi !== null && curr.rsi <= 30;

      case 'macd_cross_above': return crossUp(prev, curr, 'macdLine', 'macdSignal');
      case 'macd_cross_below': return crossDown(prev, curr, 'macdLine', 'macdSignal');
      case 'macd_hist_positive': return prev && prev.macdHist !== null && curr.macdHist !== null && prev.macdHist <= 0 && curr.macdHist > 0;
      case 'macd_hist_negative': return prev && prev.macdHist !== null && curr.macdHist !== null && prev.macdHist >= 0 && curr.macdHist < 0;

      case 'bb_break_upper': return curr.price !== null && curr.bbUpper !== null && curr.price > curr.bbUpper;
      case 'bb_break_lower': return curr.price !== null && curr.bbLower !== null && curr.price < curr.bbLower;

      case 'volume_above_avg': return curr.volume !== null && curr.volumeAvg && curr.volume > curr.volumeAvg;
      case 'volume_spike': return curr.volume !== null && curr.volumeAvg && curr.volume > curr.volumeAvg * (v || 2);

      case 'trend_change_bullish': return prev && prev.trendScore !== undefined && curr.trendScore !== undefined && prev.trendScore <= 0 && curr.trendScore > 0;
      case 'trend_change_bearish': return prev && prev.trendScore !== undefined && curr.trendScore !== undefined && prev.trendScore >= 0 && curr.trendScore < 0;

      default: return false;
    }
  }

  function crossUp(prev, curr, keyA, keyB) {
    if (!prev || prev[keyA] === null || prev[keyB] === null || curr[keyA] === null || curr[keyB] === null) return false;
    return prev[keyA] <= prev[keyB] && curr[keyA] > curr[keyB];
  }
  function crossDown(prev, curr, keyA, keyB) {
    if (!prev || prev[keyA] === null || prev[keyB] === null || curr[keyA] === null || curr[keyB] === null) return false;
    return prev[keyA] >= prev[keyB] && curr[keyA] < curr[keyB];
  }

  /** Avalia todos os alertas ativos de um ativo contra o contexto atual, disparando os que baterem. */
  function evaluate(cryptoId, currentContext) {
    const prevContext = lastSnapshot.get(cryptoId) || null;
    const relevant = alerts.filter((a) => a.cryptoId === cryptoId && a.enabled);
    const triggered = [];

    for (const alert of relevant) {
      if (isInCooldown(alert)) continue;
      if (conditionMet(alert, prevContext, currentContext)) {
        alert.lastTriggered = Date.now();
        triggered.push(alert);
        addHistoryEntry(alert, currentContext);
        if (onTriggerCallback) onTriggerCallback(alert, currentContext);
      }
    }
    if (triggered.length) saveAlerts();
    lastSnapshot.set(cryptoId, currentContext);
    return triggered;
  }

  function addHistoryEntry(alert, context) {
    const meta = typeMeta(alert.type);
    const now = new Date();
    history.unshift({
      id: 'h_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      timestamp: now.getTime(),
      cryptoId: alert.cryptoId,
      type: alert.type,
      typeLabel: meta ? meta.label : alert.type,
      price: context.price,
      message: alert.message || (meta ? meta.label : alert.type),
    });
    if (history.length > HISTORY_LIMIT) history.length = HISTORY_LIMIT;
    saveHistory();
  }

  function getHistory({ cryptoId = null, date = null } = {}) {
    return history.filter((h) => {
      if (cryptoId && h.cryptoId !== cryptoId) return false;
      if (date) {
        const d = new Date(h.timestamp);
        const dateStr = d.toISOString().slice(0, 10);
        if (dateStr !== date) return false;
      }
      return true;
    });
  }

  function clearHistory() {
    history = [];
    saveHistory();
  }

  function exportHistoryCSV() {
    const header = ['Data', 'Hora', 'Ativo', 'Tipo', 'Condição', 'Preço', 'Mensagem'];
    const rows = history.map((h) => {
      const d = new Date(h.timestamp);
      return [
        d.toLocaleDateString('pt-BR'),
        d.toLocaleTimeString('pt-BR'),
        h.cryptoId,
        h.type,
        h.typeLabel,
        h.price ?? '',
        (h.message || '').replace(/"/g, '""'),
      ];
    });
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${cell}"`).join(','))
      .join('\n');
    return csv;
  }

  function resetAll() {
    alerts = [];
    history = [];
    lastSnapshot.clear();
    saveAlerts();
    saveHistory();
  }

  load();

  return {
    ALERT_TYPES,
    listAlerts,
    createAlert,
    deleteAlert,
    toggleAlert,
    evaluate,
    onTrigger,
    getHistory,
    clearHistory,
    exportHistoryCSV,
    resetAll,
    typeMeta,
  };
})();
