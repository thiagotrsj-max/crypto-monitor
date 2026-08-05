/**
 * indicators.js — Cálculos técnicos puros (sem dependências externas).
 *
 * Convenção: toda função que recebe uma série de valores retorna um array do MESMO tamanho,
 * preenchido com `null` nas posições onde ainda não há dados suficientes para o cálculo.
 * Isso facilita alinhar os indicadores com os candles ao plotar/consultar o último valor.
 */

const Indicators = (() => {

  /** Média Móvel Simples. */
  function SMA(values, period) {
    const out = new Array(values.length).fill(null);
    if (period <= 0 || values.length < period) return out;
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[i];
      if (i >= period) sum -= values[i - period];
      if (i >= period - 1) out[i] = sum / period;
    }
    return out;
  }

  /** Média Móvel Exponencial. k = 2 / (n + 1). Semente = SMA dos primeiros `period` valores. */
  function EMA(values, period) {
    const out = new Array(values.length).fill(null);
    if (period <= 0 || values.length < period) return out;
    const k = 2 / (period + 1);

    let seed = 0;
    for (let i = 0; i < period; i++) seed += values[i];
    seed /= period;
    out[period - 1] = seed;

    let prev = seed;
    for (let i = period; i < values.length; i++) {
      const val = values[i] * k + prev * (1 - k);
      out[i] = val;
      prev = val;
    }
    return out;
  }

  /** EMA aplicada sobre um array que já pode conter `null` no início (ex: linha MACD). */
  function EMAOnSeries(series, period) {
    const firstValid = series.findIndex((v) => v !== null && v !== undefined);
    const out = new Array(series.length).fill(null);
    if (firstValid === -1) return out;
    const trimmed = series.slice(firstValid);
    const emaTrimmed = EMA(trimmed, period);
    for (let i = 0; i < emaTrimmed.length; i++) out[firstValid + i] = emaTrimmed[i];
    return out;
  }

  /** RSI (Índice de Força Relativa), período padrão 14. RSI = 100 - (100 / (1 + RS)). */
  function RSI(values, period = 14) {
    const out = new Array(values.length).fill(null);
    if (values.length <= period) return out;

    let gainSum = 0;
    let lossSum = 0;
    for (let i = 1; i <= period; i++) {
      const diff = values[i] - values[i - 1];
      if (diff >= 0) gainSum += diff; else lossSum -= diff;
    }
    let avgGain = gainSum / period;
    let avgLoss = lossSum / period;
    out[period] = computeRSI(avgGain, avgLoss);

    for (let i = period + 1; i < values.length; i++) {
      const diff = values[i] - values[i - 1];
      const gain = diff > 0 ? diff : 0;
      const loss = diff < 0 ? -diff : 0;
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      out[i] = computeRSI(avgGain, avgLoss);
    }
    return out;
  }

  function computeRSI(avgGain, avgLoss) {
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  /** MACD: linha MACD = EMA12 - EMA26; linha de Sinal = EMA9(MACD); Histograma = MACD - Sinal. */
  function MACD(values, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    const emaFast = EMA(values, fastPeriod);
    const emaSlow = EMA(values, slowPeriod);
    const macdLine = values.map((_, i) => {
      if (emaFast[i] === null || emaSlow[i] === null) return null;
      return emaFast[i] - emaSlow[i];
    });
    const signalLine = EMAOnSeries(macdLine, signalPeriod);
    const histogram = values.map((_, i) => {
      if (macdLine[i] === null || signalLine[i] === null) return null;
      return macdLine[i] - signalLine[i];
    });
    return { macdLine, signalLine, histogram };
  }

  /** Bandas de Bollinger: banda média = SMA(period); bandas sup/inf = média ± (mult * desvio padrão). */
  function BollingerBands(values, period = 20, mult = 2) {
    const middle = SMA(values, period);
    const upper = new Array(values.length).fill(null);
    const lower = new Array(values.length).fill(null);

    for (let i = period - 1; i < values.length; i++) {
      const slice = values.slice(i - period + 1, i + 1);
      const mean = middle[i];
      const variance = slice.reduce((sum, v) => sum + (v - mean) ** 2, 0) / period;
      const stdDev = Math.sqrt(variance);
      upper[i] = mean + mult * stdDev;
      lower[i] = mean - mult * stdDev;
    }
    return { upper, middle, lower };
  }

  /** Média móvel simples de volume (padrão: 20 períodos). */
  function VolumeSMA(volumes, period = 20) {
    return SMA(volumes, period);
  }

  /** Último valor não-nulo de uma série (ou null). */
  function last(series) {
    for (let i = series.length - 1; i >= 0; i--) {
      if (series[i] !== null && series[i] !== undefined) return series[i];
    }
    return null;
  }

  /**
   * Classificação automática de tendência, combinando:
   *  - Preço vs EMA9, EMA21, SMA50, SMA200
   *  - RSI(14)
   *  - MACD (linha vs sinal)
   *  - Volume vs média
   * Retorna { emoji, label, score } — score de -5 (forte baixa) a +5 (forte alta).
   */
  function classifyTrend({ price, ema9, ema21, sma50, sma200, rsi, macdLine, macdSignal, volume, volumeAvg }) {
    let score = 0;

    if (price !== null && ema9 !== null) score += price > ema9 ? 1 : -1;
    if (price !== null && ema21 !== null) score += price > ema21 ? 1 : -1;
    if (price !== null && sma50 !== null) score += price > sma50 ? 1 : -1;
    if (price !== null && sma200 !== null) score += price > sma200 ? 1 : -1;

    if (rsi !== null) {
      if (rsi >= 70) score += 0.5;
      else if (rsi <= 30) score -= 0.5;
    }

    if (macdLine !== null && macdSignal !== null) {
      score += macdLine > macdSignal ? 1 : -1;
    }

    const volumeBoost = volume !== null && volumeAvg && volume > volumeAvg * 1.3;

    let label, emoji;
    if (score >= 3.5) { label = 'Forte alta'; emoji = '🚀'; }
    else if (score >= 1.5) { label = 'Alta'; emoji = '📈'; }
    else if (score > -1.5) { label = 'Neutro / Lateral'; emoji = '➖'; }
    else if (score > -3.5) { label = 'Baixa'; emoji = '📉'; }
    else { label = 'Forte baixa'; emoji = '🔻'; }

    if (volumeBoost && score >= 1.5) label += ' (volume forte)';

    return { emoji, label, score };
  }

  return {
    SMA,
    EMA,
    EMAOnSeries,
    RSI,
    MACD,
    BollingerBands,
    VolumeSMA,
    classifyTrend,
    last,
  };
})();
