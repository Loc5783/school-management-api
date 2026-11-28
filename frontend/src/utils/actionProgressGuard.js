/**
 * @fileoverview Bộ bảo vệ chống bấm đúp (Anti-Double-Click) và tự động gắn hiệu ứng tiến trình
 * (`data-hn-net-busy` / `data-hn-react-busy`) cho toàn bộ nút hành động trên ứng dụng Frontend.
 *
 * Cơ chế hoạt động 2 lớp:
 * 1. Chặn đồng bộ (Capture Phase) trên `click`, `dblclick` và `submit`:
 *    - Khóa tức thì mọi cú bấm lặp vào nút hoặc biểu mẫu đang trong trạng thái xử lý (`busy`).
 *    - Chống bấm đúp nhanh (`< 400ms` hoặc `event.detail >= 2`) ngay trước khi React kịp re-render `disabled`.
 * 2. Liên kết trực tiếp với tầng mạng (`axiosConfig` & `localLanConnectorClient`) + `MutationObserver`:
 *    - Mọi nút hành động kích hoạt gọi API đều tự động hiển thị vòng xoay tiến trình + dải sáng chạy
 *      cho tới khi toàn bộ chuỗi request hoàn tất (tối thiểu 320ms để mắt người nhận biết rõ ràng).
 *    - Các nút điều hướng thuần giao diện (tab, menu bên, đóng modal, hiện/ẩn mật khẩu) được loại trừ
 *      để giữ nguyên phản hồi tức thì.
 */

const DOUBLE_CLICK_COOLDOWN_MS = 400;
const NETWORK_CORRELATION_WINDOW_MS = 240;
const CHAINED_REQUEST_GRACE_MS = 140;
const MIN_VISUAL_PROGRESS_MS = 320;

const EXCLUDED_CONTROL_SELECTOR = [
  '[data-no-progress="true"]',
  '[role="tab"]',
  '.nav-link',
  '.nav-sub-link',
  '.nav-accordion-header',
  '.mobile-menu-toggle',
  '.mobile-nav-close',
  '.account-tabs button',
  '.chat-tabs button',
  '.method-tabs button',
  '.filter-tabs button',
  '.timekeeping-hub-tabs button',
  '.superadmin-report-tab',
  '.sa-role-chip',
  '.hik-campus-chip',
  '.status-option',
  '.chat-list-item',
  '.parent-account',
  '.password-toggle',
  '.password-field-btn',
  '.sa-password-eye-btn',
  '.sa-preset-btn',
  '.modal-close-btn',
  '.account-modal-close',
  '.hik-modal-close',
  '.hik-alert-close',
  '.parent-payment-close',
  '.hn-live-sound-btn',
  '.hn-live-close-btn',
  '.icon-button[aria-label*="Thông báo"]'
].join(', ');

const SILENT_BACKGROUND_PATH_PATTERN = /\/(public-meta|notifications\/unread)(\?|$)/i;
const VIETNAMESE_IN_PROGRESS_TEXT_PATTERN = /^\s*(Đang\s+|⏳)/i;

const recentButtonClickMap = new WeakMap();
const recentFormSubmitMap = new WeakMap();
const trackedButtonStateMap = new WeakMap();

let activeActionContext = null;
let lastSettledContext = null;
let isGuardInstalled = false;

/**
 * Kiểm tra xem phần tử nút bấm có phải là nút thực thi tác vụ (cần hiệu ứng tiến trình & chống bấm đúp) hay không.
 *
 * @param {Element | null} el
 * @returns {el is HTMLButtonElement}
 */
function isEligibleActionButton(el) {
  if (!el || el.tagName !== 'BUTTON') return false;
  if (el.matches(EXCLUDED_CONTROL_SELECTOR)) return false;

  const ariaLabel = el.getAttribute('aria-label') || '';
  if (/^(Đóng|Ẩn mật khẩu|Hiện mật khẩu|Mở menu)/i.test(ariaLabel.trim())) {
    return false;
  }
  return true;
}

/**
 * Kiểm tra nút hiện đang bận thực thi tiến trình hay chưa.
 *
 * @param {HTMLButtonElement | null} btn
 * @returns {boolean}
 */
function isButtonCurrentlyBusy(btn) {
  if (!btn) return false;
  return (
    btn.dataset.hnNetBusy === 'true' ||
    btn.dataset.hnReactBusy === 'true' ||
    btn.getAttribute('aria-busy') === 'true' ||
    btn.classList.contains('is-busy')
  );
}

/**
 * Đồng bộ cờ `data-hn-react-busy` cho các nút được React gán `disabled` kèm nhãn `"Đang ..."`.
 *
 * @param {HTMLButtonElement} btn
 */
function syncReactDrivenBusyState(btn) {
  if (!isEligibleActionButton(btn)) {
    if (btn?.dataset?.hnReactBusy) {
      delete btn.dataset.hnReactBusy;
    }
    return;
  }

  const labelText = (btn.textContent || '').replace(/\s+/g, ' ').trim();
  const shouldBeBusy =
    btn.getAttribute('aria-busy') === 'true' ||
    (btn.disabled && VIETNAMESE_IN_PROGRESS_TEXT_PATTERN.test(labelText));

  if (shouldBeBusy) {
    if (btn.dataset.hnReactBusy !== 'true') {
      btn.dataset.hnReactBusy = 'true';
    }
  } else if (btn.dataset.hnReactBusy === 'true') {
    delete btn.dataset.hnReactBusy;
  }
}

/**
 * Quét nhẹ các nút trong một nhánh DOM để đồng bộ trạng thái tiến trình do React render.
 *
 * @param {ParentNode} root
 */
function scanButtonsInSubtree(root) {
  if (!root) return;
  if (root.nodeType === 1 && root.tagName === 'BUTTON') {
    syncReactDrivenBusyState(root);
    return;
  }
  if (typeof root.querySelectorAll === 'function') {
    const buttons = root.querySelectorAll('button');
    for (let i = 0; i < buttons.length; i += 1) {
      syncReactDrivenBusyState(buttons[i]);
    }
  }
}

/**
 * Gắn một request mạng vừa khởi tạo vào nút hành động người dùng vừa bấm để hiển thị animation
 * và giữ khóa chống bấm đúp xuyên suốt vòng đời request (kể cả chuỗi `await` liên tiếp).
 *
 * @param {{ url?: string, method?: string }} [requestMeta]
 * @returns {() => void} Hàm dọn dẹp gọi trong `finally` / response interceptor.
 */
export function beginTrackedActionNetworkCall(requestMeta = {}) {
  if (typeof document === 'undefined') return () => {};

  const reqUrl = String(requestMeta.url || '');
  const reqMethod = String(requestMeta.method || 'get').toLowerCase();
  if (reqMethod === 'get' && SILENT_BACKGROUND_PATH_PATTERN.test(reqUrl)) {
    return () => {};
  }

  const now = Date.now();
  let targetCtx = null;

  if (
    activeActionContext &&
    activeActionContext.button?.isConnected &&
    (now - activeActionContext.clickedAt <= NETWORK_CORRELATION_WINDOW_MS ||
      (trackedButtonStateMap.get(activeActionContext.button)?.inFlight || 0) > 0)
  ) {
    targetCtx = activeActionContext;
  } else if (
    lastSettledContext &&
    lastSettledContext.button?.isConnected &&
    now - lastSettledContext.settledAt <= CHAINED_REQUEST_GRACE_MS
  ) {
    // NOTE: Hỗ trợ các hàm xử lý gọi tuần tự nhiều API (`await saveSettings(); await reloadData();`)
    targetCtx = lastSettledContext;
    activeActionContext = {
      button: targetCtx.button,
      form: targetCtx.form,
      clickedAt: now
    };
  }

  if (!targetCtx || !targetCtx.button) {
    return () => {};
  }

  const { button, form } = targetCtx;
  let state = trackedButtonStateMap.get(button);
  if (!state) {
    state = { inFlight: 0, startedAt: now, releaseTimer: null };
    trackedButtonStateMap.set(button, state);
  }

  if (state.releaseTimer) {
    window.clearTimeout(state.releaseTimer);
    state.releaseTimer = null;
  }

  if (state.inFlight === 0) {
    state.startedAt = now;
  }
  state.inFlight += 1;

  button.dataset.hnNetBusy = 'true';
  if (form && form.isConnected) {
    form.dataset.hnSubmitting = 'true';
  }

  let finished = false;
  return () => {
    if (finished) return;
    finished = true;

    const current = trackedButtonStateMap.get(button);
    if (!current) return;

    current.inFlight = Math.max(0, current.inFlight - 1);
    if (current.inFlight > 0) return;

    const settledAt = Date.now();
    lastSettledContext = { button, form, settledAt };

    const elapsed = settledAt - current.startedAt;
    const remainingMs = Math.max(0, MIN_VISUAL_PROGRESS_MS - elapsed);

    current.releaseTimer = window.setTimeout(() => {
      const latest = trackedButtonStateMap.get(button);
      if (latest && latest.inFlight > 0) return;

      if (button.isConnected) {
        delete button.dataset.hnNetBusy;
      }
      if (form && form.isConnected) {
        delete form.dataset.hnSubmitting;
      }
      if (latest) {
        latest.releaseTimer = null;
      }
    }, remainingMs);
  };
}

/**
 * Cài đặt trình lắng nghe toàn cục bảo vệ chống bấm đúp và đồng bộ hiệu ứng tiến trình cho nút bấm.
 * Chỉ khởi chạy 1 lần duy nhất tại entrypoint `main.jsx`.
 */
export function installGlobalActionProgressGuard() {
  if (isGuardInstalled || typeof document === 'undefined') return;
  isGuardInstalled = true;

  // Bước 1: Chặn bấm đúp hoặc bấm lại khi nút/form đang thực thi ở pha Capture
  document.addEventListener(
    'click',
    (event) => {
      const target = event.target instanceof Element ? event.target.closest('button') : null;
      if (!target || !isEligibleActionButton(target)) return;

      const owningForm = target.form || target.closest('form');
      if (isButtonCurrentlyBusy(target) || owningForm?.dataset?.hnSubmitting === 'true') {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        return;
      }

      const now = Date.now();
      const prevClickAt = recentButtonClickMap.get(target) || 0;
      const isSubmitType = !target.getAttribute('type') || target.getAttribute('type') === 'submit';

      // Chặn triệt để thao tác nháy đúp chuột (detail >= 2) hoặc bấm lặp cực nhanh dưới 400ms
      if (event.detail >= 2 || (now - prevClickAt < DOUBLE_CLICK_COOLDOWN_MS && isSubmitType)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        return;
      }
      if (now - prevClickAt < 280) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        return;
      }

      recentButtonClickMap.set(target, now);
      activeActionContext = {
        button: target,
        form: isSubmitType ? owningForm : null,
        clickedAt: now
      };
    },
    true
  );

  document.addEventListener(
    'dblclick',
    (event) => {
      const target = event.target instanceof Element ? event.target.closest('button') : null;
      if (!target || !isEligibleActionButton(target)) return;
      event.preventDefault();
      event.stopPropagation();
    },
    true
  );

  document.addEventListener(
    'submit',
    (event) => {
      const form = event.target instanceof HTMLFormElement ? event.target : null;
      if (!form) return;

      const submitBtn =
        (event.submitter instanceof HTMLButtonElement ? event.submitter : null) ||
        form.querySelector('button[type="submit"], button:not([type])');

      if (form.dataset.hnSubmitting === 'true' || isButtonCurrentlyBusy(submitBtn)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        return;
      }

      const now = Date.now();
      const prevSubmitAt = recentFormSubmitMap.get(form) || 0;
      if (now - prevSubmitAt < DOUBLE_CLICK_COOLDOWN_MS) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        return;
      }

      recentFormSubmitMap.set(form, now);
      if (submitBtn && isEligibleActionButton(submitBtn)) {
        activeActionContext = {
          button: submitBtn,
          form,
          clickedAt: now
        };
      }
    },
    true
  );

  // Bước 2: Quan sát thay đổi thuộc tính `disabled` / `aria-busy` / nhãn chữ của nút để bật/tắt vòng xoay tự động
  let rafScheduled = false;
  const dirtyButtons = new Set();

  const flushDirtyButtons = () => {
    rafScheduled = false;
    dirtyButtons.forEach((btn) => {
      if (btn.isConnected) syncReactDrivenBusyState(btn);
    });
    dirtyButtons.clear();
  };

  const enqueueButtonSync = (btn) => {
    if (!btn || btn.tagName !== 'BUTTON') return;
    dirtyButtons.add(btn);
    if (!rafScheduled) {
      rafScheduled = true;
      window.requestAnimationFrame(flushDirtyButtons);
    }
  };

  const observer = new MutationObserver((mutations) => {
    for (let i = 0; i < mutations.length; i += 1) {
      const m = mutations[i];
      if (m.type === 'attributes' && m.target.tagName === 'BUTTON') {
        enqueueButtonSync(m.target);
      } else if (m.type === 'characterData') {
        const parentBtn = m.target.parentElement?.closest?.('button');
        if (parentBtn) enqueueButtonSync(parentBtn);
      } else if (m.type === 'childList') {
        if (m.target.tagName === 'BUTTON') {
          enqueueButtonSync(m.target);
        } else {
          const parentBtn = m.target.closest?.('button');
          if (parentBtn) {
            enqueueButtonSync(parentBtn);
          } else {
            for (let j = 0; j < m.addedNodes.length; j += 1) {
              const node = m.addedNodes[j];
              if (node.nodeType === 1) scanButtonsInSubtree(node);
            }
          }
        }
      }
    }
  });

  if (document.body) {
    scanButtonsInSubtree(document.body);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['disabled', 'aria-busy', 'class']
    });
  }
}

