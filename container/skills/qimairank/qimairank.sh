#!/usr/bin/env bash
set -euo pipefail

# qimairank - 获取七麦数据 iOS 排名上升榜
# 使用 bb-browser 访问 qimai.cn 并提取数据

TOP="${TOP:-20}"
GENRE="${GENRE:-36}"
COUNTRY="${COUNTRY:-us}"
DEVICE="${DEVICE:-iphone}"
BRAND="${BRAND:-free}"
FORMAT="${FORMAT:-text}"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --top)    TOP="$2"; shift 2 ;;
    --genre)  GENRE="$2"; shift 2 ;;
    --country) COUNTRY="$2"; shift 2 ;;
    --device) DEVICE="$2"; shift 2 ;;
    --brand)  BRAND="$2"; shift 2 ;;
    --format) FORMAT="$2"; shift 2 ;;
    --help|-h)
      echo "Usage: qimairank [OPTIONS]"
      echo "  --top N        Number of apps to fetch (default: 20)"
      echo "  --genre ID     Category ID (default: 36 = all apps)"
      echo "  --country CC   Country code (default: us)"
      echo "  --device DEV   Device type (default: iphone)"
      echo "  --brand TYPE   free/paid/grossing (default: free)"
      echo "  --format FMT   Output format: text (default) or json"
      exit 0 ;;
    *) echo "Unknown option: $1. Use --help for usage."; exit 1 ;;
  esac
done

URL="https://www.qimai.cn/rank/float/float/up/genre/${GENRE}/device/${DEVICE}/type/one/brand/${BRAND}/country/${COUNTRY}"

# Check if qimai.cn is accessible
echo "检查 qimai.cn 可访问性..." >&2
if ! curl -s --connect-timeout 5 --max-time 10 -I "https://www.qimai.cn" > /dev/null 2>&1; then
  echo "错误: 无法访问 qimai.cn，请检查网络连接或 VPN 设置" >&2
  exit 1
fi
echo "qimai.cn 可访问，继续获取数据..." >&2

# Open page
bb-browser open "$URL" > /dev/null 2>&1

# Ensure tab is closed on exit (even on error)
trap 'bb-browser close > /dev/null 2>&1 || true' EXIT

# Extract data — polls via Promise until table rows appear (up to 8s), no fixed wait
RESULT=$(bb-browser eval "
new Promise(function(resolve, reject) {
  var maxWait = 8000;
  var interval = 200;
  var elapsed = 0;
  var top = ${TOP};
  var fmt = '${FORMAT}';
  var country = '${COUNTRY}'.toUpperCase();
  var brand = '${BRAND}';

  function extractData() {
    var rows = document.querySelectorAll('.ivu-table-row');
    var apps = [];
    for (var i = 0; i < Math.min(top, rows.length); i++) {
      var cells = rows[i].querySelectorAll('td');
      if (cells.length < 5) continue;
      var appLink = cells[1] ? cells[1].querySelector('a[href*=\"/app/\"]') : null;
      var imgEl = appLink ? appLink.querySelector('img') : null;
      var rowText = cells[1] ? cells[1].querySelector('.row-a') : null;
      var devText = rowText ? rowText.innerText.split('\\n').pop().trim() : '';
      var rawName = ((imgEl ? imgEl.alt : '') || (appLink ? appLink.innerText.trim() : '')).replace(/\*/g, '');
      apps.push({
        rank: cells[0] ? cells[0].innerText.trim() : '',
        appName: rawName,
        appUrl: (function() { var m = appLink && appLink.getAttribute('href').match(/appid\/(\d+)/); return m ? 'https://apps.apple.com/' + country.toLowerCase() + '/app/id' + m[1] : ''; })(),
        developer: devText,
        rankChange: cells[2] && cells[2].querySelector('.change-text') ? cells[2].querySelector('.change-text').innerText.trim() : '',
        overallRank: cells[3] && cells[3].querySelector('.big-txt') ? cells[3].querySelector('.big-txt').innerText.trim() : '',
        overallCategory: cells[3] && cells[3].querySelector('.small-txt') ? cells[3].querySelector('.small-txt').innerText.trim() : '',
        categoryRank: cells[4] && cells[4].querySelector('.big-txt') ? cells[4].querySelector('.big-txt').innerText.trim() : '',
        categoryName: cells[4] && cells[4].querySelector('.small-txt') ? cells[4].querySelector('.small-txt').innerText.trim() : ''
      });
    }
    if (fmt === 'json') {
      return JSON.stringify(apps, null, 2);
    }
    var lines = [];

    // --- 完整榜单 ---
    lines.push('iOS 24h 排名上升榜 (' + country.toUpperCase() + ' ' + brand + ')');
    lines.push('');
    for (var j = 0; j < apps.length; j++) {
      var a = apps[j];
      lines.push(a.rank + '. ' + a.appName + ' | +' + a.rankChange + ' | 总榜#' + a.overallRank + ' | ' + a.categoryName + '#' + a.categoryRank);
    }

    // --- 榜单小结（底部）---
    var sorted = apps.slice().sort(function(a, b) { return parseInt(b.rankChange) - parseInt(a.rankChange); });
    var topMovers = sorted.slice(0, 10);
    lines.push('');
    lines.push('--- 榜单小结 ---');
    lines.push('');
    lines.push('冲榜最猛 Top 10:');
    for (var m = 0; m < topMovers.length; m++) {
      lines.push('  ' + (m + 1) + '. ' + topMovers[m].appName + ' (+' + topMovers[m].rankChange + ')');
      lines.push('  ' + topMovers[m].appUrl);
    }
    var hotApps = apps.filter(function(a) { return parseInt(a.overallRank) <= 20; });
    if (hotApps.length > 0) {
      lines.push('');
      lines.push('头部热门 (总榜前20还在涨):');
      for (var h = 0; h < hotApps.length; h++) {
        lines.push('  ' + hotApps[h].appName + ' (总榜#' + hotApps[h].overallRank + ', +' + hotApps[h].rankChange + ')');
        lines.push('  ' + hotApps[h].appUrl);
      }
    }
    var catCount = {};
    for (var c = 0; c < apps.length; c++) {
      var cat = apps[c].categoryName.replace(/\(.*\)/, '').trim();
      catCount[cat] = (catCount[cat] || 0) + 1;
    }
    var catPairs = [];
    for (var k in catCount) { catPairs.push([k, catCount[k]]); }
    catPairs.sort(function(a, b) { return b[1] - a[1]; });
    var hotCats = catPairs.filter(function(p) { return p[1] >= 2; });
    if (hotCats.length > 0) {
      lines.push('');
      lines.push('热门分类:');
      for (var t = 0; t < hotCats.length; t++) {
        lines.push('  ' + hotCats[t][0] + ' (' + hotCats[t][1] + '款)');
      }
    }
    return lines.join('\\n');
  }

  function check() {
    var rows = document.querySelectorAll('.ivu-table-row');
    if (rows.length > 0) {
      resolve(extractData());
    } else if (elapsed >= maxWait) {
      reject(new Error('页面加载超时，未找到排名数据（等待 ' + maxWait + 'ms）'));
    } else {
      elapsed += interval;
      setTimeout(check, interval);
    }
  }
  check();
})")

echo "$RESULT"
