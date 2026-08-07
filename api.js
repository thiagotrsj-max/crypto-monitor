/**
 * api.js — Integração com a CoinGecko API (gratuita, sem autenticação).
 *
 * Responsabilidades:
 *  - Buscar dados de mercado (preço, variação 24h, volume, market cap) para vários ativos de uma vez.
 *  - Buscar histórico de preços/volume e transformar em candles OHLCV para o gráfico.
 *  - Cache local (com TTL) + retry automático com backoff exponencial, para lidar com
 *    o rate-limit generoso porém finito da API gratuita.
 *
 * Limitação conhecida da CoinGecko free tier: o endpoint /market_chart não devolve OHLC "puro",
 * apenas séries de [timestamp, valor]. Por isso construímos candles agrupando (bucketizando) essa
 * série no timeframe escolhido. A granularidade bruta devolvida pela API depende do parâmetro `days`:
 *   days = 1        -> ~5 minutos entre pontos
 *   1 < days <= 90   -> ~1 hora entre pontos
 *   days > 90        -> ~1 dia entre pontos
 * Ou seja, timeframes menores que a granularidade bruta (ex: "1M" quando a API só dá pontos de 5 em 5
 * minutos) são uma aproximação — cada candle nesse caso reflete o próprio ponto bruto da API.
 */

const CryptoAPI = (() => {
  const BASE_URL = 'https://api.coingecko.com/api/v3';

  const CACHE_TTL = {
    markets: 20 * 1000,       // 20s
    marketChart: 60 * 1000,   // 60s
  };

  // `days` foi dimensionado para garantir candles suficientes mesmo para médias móveis de
  // período 100 (usadas pelos alertas de cruzamento configurável — ver alerts.js). Como o custo
  // de uma chamada à API não depende de `days` (é sempre 1 requisição), pedir mais histórico
  // aqui não aumenta o risco de rate-limit.
  const TIMEFRAME_CONFIG = {
    '1m':  { days: 1,   bucketMs: 5 * 60 * 1000 },
    '5m':  { days: 1,   bucketMs: 5 * 60 * 1000 },
    '15m': { days: 1,   bucketMs: 15 * 60 * 1000 },
    '1h':  { days: 14,  bucketMs: 60 * 60 * 1000 },
    '4h':  { days: 60,  bucketMs: 4 * 60 * 60 * 1000 },
    '1d':  { days: 200, bucketMs: 24 * 60 * 60 * 1000 },
    '1w':  { days: 800, bucketMs: 7 * 24 * 60 * 60 * 1000 },
  };

  const cache = new Map(); // key -> { data, expiresAt }

  function getCache(key) {
    const hit = cache.get(key);
    if (!hit) return null;
    if (Date.now() > hit.expiresAt) return null;
    return hit.data;
  }

  function setCache(key, data, ttl) {
    cache.set(key, { data, expiresAt: Date.now() + ttl });
  }

  function getStale(key) {
    const hit = cache.get(key);
    return hit ? hit.data : null;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * fetch com retry automático (backoff exponencial: 500ms, 1000ms, 2000ms) e cache de fallback:
   * se todas as tentativas falharem mas houver dado em cache (mesmo expirado), retorna o cache
   * antigo em vez de propagar o erro — evita que a UI quebre por uma falha momentânea de rede.
   */
  async function fetchWithRetry(url, cacheKey, ttl, { retries = 3 } = {}) {
    const cached = getCache(cacheKey);
    if (cached) return cached;

    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch(url);
        if (!res.ok) {
          if (res.status === 429) throw new Error('Rate limit da API (429). Aguardando antes de tentar novamente.');
          throw new Error(`Erro HTTP ${res.status}`);
        }
        const data = await res.json();
        setCache(cacheKey, data, ttl);
        return data;
      } catch (err) {
        lastError = err;
        if (attempt < retries) {
          await sleep(500 * Math.pow(2, attempt));
        }
      }
    }

    const stale = getStale(cacheKey);
    if (stale) {
      console.warn('CryptoAPI: usando cache expirado após falhas de rede:', lastError);
      return stale;
    }
    throw lastError;
  }

  /**
   * Busca dados de mercado (preço, variação, volume, market cap, alta/baixa 24h) para uma lista
   * de ids CoinGecko, em uma única chamada.
   */
  async function getMarkets(ids, currency = 'usd') {
    const idsParam = ids.join(',');
    const url = `${BASE_URL}/coins/markets?vs_currency=${currency}&ids=${idsParam}&order=market_cap_desc&sparkline=false&price_change_percentage=24h`;
    const key = `markets:${currency}:${idsParam}`;
    return fetchWithRetry(url, key, CACHE_TTL.markets);
  }

  /** Busca a série bruta de preços e volumes de um ativo, para os últimos N dias. */
  async function getMarketChart(id, currency, days) {
    const url = `${BASE_URL}/coins/${id}/market_chart?vs_currency=${currency}&days=${days}`;
    const key = `chart:${id}:${currency}:${days}`;
    return fetchWithRetry(url, key, CACHE_TTL.marketChart);
  }

  /** Agrupa uma série [ [timestamp, valor], ... ] em buckets de `bucketMs`, formando candles OHLC. */
  function bucketizePrices(rawPrices, bucketMs) {
    if (!rawPrices || rawPrices.length === 0) return [];
    const buckets = new Map();

    for (const [ts, price] of rawPrices) {
      const bucketStart = Math.floor(ts / bucketMs) * bucketMs;
      if (!buckets.has(bucketStart)) {
        buckets.set(bucketStart, { time: bucketStart, open: price, high: price, low: price, close: price });
      } else {
        const c = buckets.get(bucketStart);
        c.high = Math.max(c.high, price);
        c.low = Math.min(c.low, price);
        c.close = price;
      }
    }

    return Array.from(buckets.values()).sort((a, b) => a.time - b.time);
  }

  /** Agrupa uma série [ [timestamp, volume], ... ] somando os volumes por bucket. */
  function bucketizeVolumes(rawVolumes, bucketMs) {
    if (!rawVolumes || rawVolumes.length === 0) return new Map();
    const buckets = new Map();
    for (const [ts, vol] of rawVolumes) {
      const bucketStart = Math.floor(ts / bucketMs) * bucketMs;
      buckets.set(bucketStart, (buckets.get(bucketStart) || 0) + vol);
    }
    return buckets;
  }

  /**
   * Retorna candles OHLCV prontos para o gráfico, para o timeframe pedido.
   * `time` é em segundos (formato esperado pela TradingView Lightweight Charts).
   */
  async function getCandles(id, currency, timeframe) {
    const config = TIMEFRAME_CONFIG[timeframe] || TIMEFRAME_CONFIG['1d'];
    const chart = await getMarketChart(id, currency, config.days);

    const candles = bucketizePrices(chart.prices, config.bucketMs);
    const volumeBuckets = bucketizeVolumes(chart.total_volumes, config.bucketMs);

    return candles.map((c) => ({
      time: Math.floor(c.time / 1000),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: volumeBuckets.get(c.time) || 0,
    }));
  }

  /**
   * Série diária de fechamentos/volumes, usada para calcular indicadores que precisam de bastante
   * histórico (ex: SMA/EMA 200 exigem >= 200 pontos). `days=260` garante folga suficiente.
   * Como days > 90, a CoinGecko já devolve granularidade diária "nativa", sem necessidade de bucketizar.
   */
  async function getDailySeries(id, currency = 'usd', days = 260) {
    const chart = await getMarketChart(id, currency, days);
    return {
      closes: (chart.prices || []).map((p) => p[1]),
      volumes: (chart.total_volumes || []).map((v) => v[1]),
    };
  }

  // ------------------------------------------------------------------------------------------
  // Fear & Greed Index — fonte separada (alternative.me), gratuita e sem chave. É um índice de
  // SENTIMENTO GERAL do mercado cripto (não é específico de um ativo). Reaproveita o mesmo
  // fetchWithRetry (cache + retry) usado para a CoinGecko, mesmo sendo outro domínio, já que
  // fetchWithRetry só depende da URL completa passada.
  // ------------------------------------------------------------------------------------------
  const FNG_URL = 'https://api.alternative.me/fng/?limit=1';
  const FNG_TTL = 10 * 60 * 1000; // o índice só é recalculado ~1x/dia; 10min de cache é de sobra

  /** Retorna { value: 0-100, classification: 'Extreme Fear'|'Fear'|'Neutral'|'Greed'|'Extreme Greed', timestamp } */
  async function getFearGreedIndex() {
    const data = await fetchWithRetry(FNG_URL, 'feargreed', FNG_TTL);
    const entry = data?.data?.[0];
    if (!entry) throw new Error('Resposta inesperada do Fear & Greed Index');
    return {
      value: Number(entry.value),
      classification: entry.value_classification,
      timestamp: Number(entry.timestamp) * 1000,
    };
  }

  return {
    BASE_URL,
    TIMEFRAME_CONFIG,
    getMarkets,
    getMarketChart,
    getCandles,
    getDailySeries,
    getFearGreedIndex,
  };
})();
