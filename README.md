# 📊 Crypto Monitor v0.01

Sistema de monitoramento de criptomoedas que roda **inteiramente no navegador** — sem backend, sem build, sem frameworks. HTML5 + CSS3 + JavaScript vanilla.

## ✨ Funcionalidades

- Gráfico de candles (TradingView Lightweight Charts) com timeframes de 1M a 1W
- Indicadores técnicos: SMA (9/20/50/200), EMA (9/21), RSI (14), MACD, Bandas de Bollinger, Volume médio
- Classificação automática de tendência combinando preço, médias, RSI, MACD e volume
- Sistema de alertas com 28 tipos de condição (preço, médias, RSI, MACD, Bollinger, volume, tendência), cooldown configurável, notificações do navegador + som
  - Inclui alerta de **cruzamento de médias configurável**: escolha uma ou mais moedas, o timeframe (1M a 1W) e o tipo/período de cada média (SMA ou EMA, períodos 7/9/21/50/100) — ex: "EMA 7 cruza para cima da EMA 21 no 1H"
- Views: Painel, Ativos (tabela ordenável e pesquisável), Favoritos, Alertas, Histórico (com exportação CSV) e Configurações
- Aba **🎯 Análise Técnica**: combina RSI, MACD, Médias Móveis, Volume e o Fear & Greed Index (via [alternative.me](https://alternative.me/crypto/fear-and-greed-index/)) num sinal técnico único para o ativo selecionado (principal ou memecoin), com uma estimativa de região de preço para entrada/saída baseada nas médias e Bandas de Bollinger mais próximas do preço atual
- Aba dedicada de **Memecoins** (🐸) com ~30 tokens (SHIB, PEPE, FLOKI, BONK, WIF, e mais), preço/variação/volume/market cap, busca e ordenação — carregada sob demanda (só quando a aba é aberta ou você clica em Atualizar), fora do ciclo de polling automático, para não somar risco de rate-limit
- Modo Demo com dados simulados (manual ou automático, caso a API fique indisponível)
- Tema claro/escuro, responsivo para mobile/tablet/desktop
- Persistência 100% local via `localStorage` — nenhum dado sai do seu navegador

## 🗂 Estrutura

```
crypto-monitor/
├── index.html      # estrutura da UI
├── style.css        # tema, layout e responsividade
├── app.js           # estado da app, views e orquestração
├── api.js           # integração com a CoinGecko API
├── indicators.js    # cálculos técnicos (SMA, EMA, RSI, MACD, Bollinger)
├── alerts.js        # motor de alertas e histórico
└── README.md
```

## 🚀 Como rodar

Não há dependências para instalar. Basta servir os arquivos estáticos:

```bash
python -m http.server 8000
```

Depois abra `http://localhost:8000` no navegador.

> Também funciona abrindo `index.html` diretamente no navegador, mas alguns navegadores restringem `fetch` em `file://` — preferir o servidor local acima.

## 🔌 Dados

Os dados vêm da [CoinGecko API](https://www.coingecko.com/en/api) pública (sem necessidade de chave). Por ser o plano gratuito, há um limite de requisições por minuto — o app já implementa cache local e retry automático para lidar com isso. Se a API ficar indisponível, o app cai automaticamente em **Modo Demo** com dados simulados.

**Limitação conhecida:** o endpoint gratuito de histórico (`/market_chart`) não devolve candles OHLC nativos para timeframes intraday — o app reconstrói candles agrupando a série de preços retornada. Para timeframes muito curtos (1M/5M), a granularidade real da API (~5 min) é o limite de precisão.

## ⚠️ Aviso

Sistema informativo e educacional. **Não é recomendação de investimento.**
