/**
 * widget-script.ts — Script nhúng phục vụ tại `GET /widget.js`.
 *
 * Viết bằng JS thuần, không phụ thuộc thư viện: nó chạy trên website của người
 * khác, không được giả định họ có React/jQuery hay bất cứ thứ gì.
 *
 * Mọi thứ nằm trong Shadow DOM để CSS của website chủ không phá giao diện nút
 * chat, và ngược lại CSS của nút không rò ra làm hỏng trang của họ.
 */
import type { FastifyInstance } from 'fastify'

/**
 * TOÀN BỘ khối dưới đây là mã chạy trên trình duyệt của khách, nằm trong một
 * template literal. TUYỆT ĐỐI không dùng dấu backtick hay ${...} bên trong —
 * kể cả trong chú thích — vì chúng cắt đứt chuỗi và làm hỏng cả tệp.
 * String.raw giữ nguyên dấu gạch chéo nên regex viết bình thường vẫn đúng.
 */
const SCRIPT = String.raw`(function () {
  'use strict';
  var s = document.currentScript;
  if (!s) return;
  var KEY = s.getAttribute('data-site-key');
  var API = (s.getAttribute('data-api') || new URL(s.src).origin).replace(/\/$/, '');
  if (!KEY) { console.error('[chatmql-chat] thiếu data-site-key'); return; }
  if (window.__chatmqlChatLoaded) return;
  window.__chatmqlChatLoaded = true;

  // Khách quay lại phải vào đúng hội thoại cũ → id lưu trong localStorage.
  var VKEY = 'chatmql_visitor_' + KEY;
  var visitorId;
  try {
    visitorId = localStorage.getItem(VKEY);
    if (!visitorId) {
      visitorId = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      localStorage.setItem(VKEY, visitorId);
    }
  } catch (e) {
    // Chế độ riêng tư chặn localStorage → vẫn chat được, chỉ mất lịch sử khi đóng tab.
    visitorId = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  var esc = function (t) {
    var d = document.createElement('div'); d.textContent = t == null ? '' : String(t);
    return d.innerHTML;
  };

  // Khung xem trước trong màn Tích hợp chạy trong iframe srcdoc nên Origin là
  // "null" — danh sách tên miền (đúng đắn) sẽ chặn nó. Cho phép truyền sẵn cấu
  // hình qua data-preview-config để xem trước không phải gọi API công khai;
  // KHÔNG nới lỏng lớp chặn tên miền, vì đó là thứ duy nhất ngăn website lạ
  // đẩy tin vào hộp thư của công ty.
  var PREVIEW = s.getAttribute('data-preview-config');
  if (PREVIEW) {
    try { render(JSON.parse(PREVIEW)); }
    catch (e) { console.error('[chatmql-chat] preview config hỏng:', e.message); }
  } else {
    fetch(API + '/api/v1/widget/' + encodeURIComponent(KEY) + '/config')
      .then(function (r) { if (!r.ok) throw new Error('config ' + r.status); return r.json(); })
      .then(render)
      .catch(function (e) { console.error('[chatmql-chat]', e.message); });
  }

  function render(cfg) {
    var host = document.createElement('div');
    host.id = 'chatmql-chat-widget';
    document.body.appendChild(host);
    // Shadow DOM: cách ly hai chiều với CSS của website chủ.
    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

    var side = cfg.position === 'left' ? 'left' : 'right';
    var color = cfg.primaryColor || '#0045ff';
    var ch = cfg.channels || {};
    // Tên khách nhìn thấy. Backend đã lùi về title khi bỏ trống, nhưng script
    // có thể chạy với bản cache cũ nên vẫn phải tự lùi ở đây.
    var brand = cfg.displayName || cfg.title || 'Chat';
    // Chỉ nhận http(s) — backend đã lọc, đây là lớp chặn thứ hai ngay tại trình duyệt.
    var logoRaw = cfg.logoUrl || '';
    var logo = (logoRaw.indexOf('https://') === 0 || logoRaw.indexOf('http://') === 0) ? logoRaw : '';
    function logoImg(cls) {
      return logo ? '<img class="' + cls + '" src="' + esc(logo) + '" alt="">' : '';
    }
    var hasMenu = [ch.liveChat, ch.zalo, ch.facebook, ch.phone].filter(Boolean).length > 1;

    var style = document.createElement('style');
    style.textContent = [
      ':host{all:initial}',
      '*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}',
      '.w{position:fixed;bottom:20px;' + side + ':20px;z-index:2147483000;display:flex;flex-direction:column;align-items:' + (side === 'left' ? 'flex-start' : 'flex-end') + ';gap:10px}',
      '.btn{width:56px;height:56px;border-radius:50%;border:0;cursor:pointer;background:' + color + ';color:#fff;box-shadow:0 6px 20px rgba(0,0,0,.22);display:flex;align-items:center;justify-content:center;transition:transform .15s}',
      '.btn:hover{transform:scale(1.06)}',
      '.menu{display:none;flex-direction:column;gap:8px}',
      '.menu.on{display:flex}',
      '.item{display:flex;align-items:center;gap:8px;background:#fff;border:1px solid #e5e7eb;border-radius:24px;padding:8px 14px;cursor:pointer;font-size:14px;color:#111827;box-shadow:0 3px 12px rgba(0,0,0,.12);text-decoration:none;white-space:nowrap}',
      '.item:hover{background:#f9fafb}',
      '.dot{width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;color:#fff;flex-shrink:0}',
      '.panel{display:none;flex-direction:column;width:340px;max-width:calc(100vw - 32px);height:460px;max-height:calc(100vh - 120px);background:#fff;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.24);overflow:hidden}',
      '.panel.on{display:flex}',
      '.hd{background:' + color + ';color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px}',
      '.hd .txt{flex:1;min-width:0}',
      '.hd b{font-size:15px;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.hd small{font-size:12px;opacity:.85;display:block}',
      // Nền trắng phía sau logo: logo nào cũng có thể trùng màu thương hiệu.
      '.logo{width:34px;height:34px;border-radius:50%;object-fit:cover;background:#fff;flex-shrink:0}',
      '.btn .logo{width:100%;height:100%;border-radius:50%}',
      '.x{background:none;border:0;color:#fff;cursor:pointer;font-size:20px;line-height:1;padding:0 2px}',
      '.body{flex:1;overflow-y:auto;padding:14px;background:#f8fafc;display:flex;flex-direction:column;gap:8px}',
      '.m{max-width:80%;padding:8px 12px;border-radius:14px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-break:break-word}',
      '.me{align-self:flex-end;background:' + color + ';color:#fff;border-bottom-right-radius:4px}',
      '.them{align-self:flex-start;background:#fff;border:1px solid #e5e7eb;color:#111827;border-bottom-left-radius:4px}',
      '.ft{display:flex;gap:8px;padding:10px;border-top:1px solid #eef2f7;background:#fff}',
      '.ft input{flex:1;border:1px solid #e5e7eb;border-radius:20px;padding:9px 14px;font-size:14px;outline:none}',
      '.ft input:focus{border-color:' + color + '}',
      '.send{border:0;background:' + color + ';color:#fff;border-radius:50%;width:38px;height:38px;cursor:pointer;flex-shrink:0}',
      '.send:disabled{opacity:.5;cursor:default}',
    ].join('');
    root.appendChild(style);

    var items = '';
    if (ch.liveChat) items += '<button class="item" data-act="live"><span class="dot" style="background:' + color + '">&#128172;</span>Chat trực tiếp</button>';
    if (ch.zalo) items += '<a class="item" href="' + esc(ch.zalo) + '" target="_blank" rel="noreferrer"><span class="dot" style="background:#0068ff">Z</span>Chat Zalo</a>';
    if (ch.facebook) items += '<a class="item" href="' + esc(ch.facebook) + '" target="_blank" rel="noreferrer"><span class="dot" style="background:#0866ff">f</span>Chat Facebook</a>';
    if (ch.phone) items += '<a class="item" href="tel:' + esc(ch.phone) + '"><span class="dot" style="background:#16a34a">&#9742;</span>Gọi ' + esc(ch.phone) + '</a>';

    var wrap = document.createElement('div');
    wrap.className = 'w';
    wrap.innerHTML =
      '<div class="panel"><div class="hd">' + logoImg('logo') +
        '<span class="txt"><b>' + esc(brand) + '</b><small>' + esc(cfg.title) + '</small></span>' +
        '<button class="x" aria-label="Đóng">&times;</button></div>' +
      '<div class="body"></div>' +
      '<form class="ft"><input type="text" placeholder="Nhập tin nhắn…" autocomplete="off"><button class="send" type="submit" aria-label="Gửi">&#10148;</button></form></div>' +
      '<div class="menu">' + items + '</div>' +
      '<button class="btn" aria-label="' + esc(brand) + '">' + (logo
        ? logoImg('logo')
        : '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>') + '</button>';
    root.appendChild(wrap);

    var q = function (sel) { return wrap.querySelector(sel); };
    var panel = q('.panel'), menu = q('.menu'), body = q('.body'), form = q('.ft'), input = q('input'), sendBtn = q('.send');
    var lastAt = null, timer = null, greeted = false;
    // seen: id tin đã vẽ — poll gọi lặp lại nên phải chặn vẽ trùng.
    // pending: bong bóng vẽ lạc quan lúc bấm Gửi, chờ bản chính thức
    // từ máy chủ về để nhận id; nếu không sẽ hiện tin của mình 2 lần.
    var seen = {}, pending = [];

    function add(text, mine) {
      var d = document.createElement('div');
      d.className = 'm ' + (mine ? 'me' : 'them');
      d.textContent = text;
      body.appendChild(d);
      body.scrollTop = body.scrollHeight;
      return d;
    }

    function poll() {
      var u = API + '/api/v1/widget/' + encodeURIComponent(KEY) + '/messages?visitorId=' + encodeURIComponent(visitorId) + (lastAt ? '&after=' + encodeURIComponent(lastAt) : '');
      fetch(u).then(function (r) { return r.ok ? r.json() : { messages: [] }; }).then(function (d) {
        (d.messages || []).forEach(function (m) {
          lastAt = m.at;
          if (!m.text || seen[m.id]) return;
          seen[m.id] = 1;
          // Tin của chính khách: nhận lại bong bóng đã vẽ lạc quan thay vì vẽ mới.
          if (!m.fromShop) {
            var i = pending.indexOf(m.text);
            if (i >= 0) { pending.splice(i, 1); return; }
          }
          add(m.text, !m.fromShop);
        });
      }).catch(function () {});
    }

    function openLive() {
      menu.classList.remove('on');
      panel.classList.add('on');
      if (!greeted) { greeted = true; if (cfg.greeting) add(cfg.greeting, false); poll(); }
      // Hỏi lại mỗi 4 giây — đủ nhanh để thấy nhân viên trả lời, đủ thưa để không nặng máy chủ.
      if (!timer) timer = setInterval(poll, 4000);
      input.focus();
    }
    function closeAll() {
      panel.classList.remove('on'); menu.classList.remove('on');
      if (timer) { clearInterval(timer); timer = null; }
    }

    q('.btn').addEventListener('click', function () {
      if (panel.classList.contains('on')) return closeAll();
      if (!hasMenu && ch.liveChat) return openLive();
      if (!hasMenu && ch.zalo) return window.open(ch.zalo, '_blank');
      menu.classList.toggle('on');
    });
    q('.x').addEventListener('click', closeAll);
    var liveBtn = wrap.querySelector('[data-act="live"]');
    if (liveBtn) liveBtn.addEventListener('click', openLive);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var text = input.value.trim();
      if (!text) return;
      input.value = '';
      add(text, true);
      pending.push(text);
      sendBtn.disabled = true;
      fetch(API + '/api/v1/widget/' + encodeURIComponent(KEY) + '/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitorId: visitorId, text: text, pageUrl: location.href }),
      }).then(function (r) {
        if (!r.ok) {
          var j = pending.indexOf(text); if (j >= 0) pending.splice(j, 1);
          add('Không gửi được tin. Vui lòng thử lại.', false);
        }
        setTimeout(poll, 900);
      }).catch(function () {
        var j = pending.indexOf(text); if (j >= 0) pending.splice(j, 1);
        add('Mất kết nối. Vui lòng thử lại.', false);
      }).finally(function () { sendBtn.disabled = false; input.focus(); });
    });
  }
})();`

export async function widgetScriptRoutes(app: FastifyInstance): Promise<void> {
  app.get('/widget.js', async (_request, reply) => {
    return reply
      .type('application/javascript; charset=utf-8')
      // Cho phép mọi website tải — đây là tài nguyên công khai theo thiết kế.
      .header('Access-Control-Allow-Origin', '*')
      // BẮT BUỘC: helmet đặt mặc định `same-origin`, trình duyệt sẽ chặn script
      // với ERR_BLOCKED_BY_RESPONSE.NotSameOrigin trên MỌI website khách.
      .header('Cross-Origin-Resource-Policy', 'cross-origin')
      .header('Cache-Control', 'public, max-age=300')
      .send(SCRIPT)
  })
}
