import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import {
  getChatContacts, getConversations, openConversation,
  getChatMessages, sendChatMessage, updateChatMessage, deleteChatMessage,
  markChatRead, getConversationById, setChatArchived
} from '../api/chat';

const timeLabel = (value) => value ? new Date(value).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '';
const errorText = (error, fallback) => error.response?.data?.message || fallback;

export default function Messages() {
  const [searchParams, setSearchParams] = useSearchParams();
  const conversationParam = searchParams.get('conversation');
  const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
  const [threads, setThreads] = useState([]);
  const [threadPage, setThreadPage] = useState(1);
  const [threadTotalPages, setThreadTotalPages] = useState(0);
  const [contacts, setContacts] = useState([]);
  const [contactPage, setContactPage] = useState(1);
  const [contactTotalPages, setContactTotalPages] = useState(0);
  const [contactSearch, setContactSearch] = useState('');
  const [activeTab, setActiveTab] = useState('conversations');
  const [selectedId, setSelectedId] = useState('');
  const [selectedContact, setSelectedContact] = useState(null);
  const [messages, setMessages] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [editingMessage, setEditingMessage] = useState(null);
  const messagePaneRef = useRef(null);
  const selectionRef = useRef('');

  const selected = threads.find((item) => item._id === selectedId) || selectedContact;
  const switchTab = (tab) => {
    setActiveTab(tab); setSelectedId(''); setSelectedContact(null); setMessages([]);
    setEditingMessage(null); setDraft(''); setSearchParams({}); setNotice('');
  };

  const loadThreads = useCallback(async (page = 1) => {
    const response = await getConversations({ page, limit: 20, archived: activeTab === 'archived' });
    setThreads(response.data.data || []);
    setThreadPage(page);
    setThreadTotalPages(response.data.pagination?.totalPages || 0);
  }, [activeTab]);

  const loadContacts = useCallback(async (page = 1, search = '') => {
    const response = await getChatContacts({ page, limit: 20, search });
    setContacts(response.data.data || []);
    setContactPage(page);
    setContactTotalPages(response.data.pagination?.totalPages || 0);
  }, []);

  const loadLatest = useCallback(async (id, initial = false) => {
    const pane = messagePaneRef.current;
    const nearBottom = !pane || pane.scrollHeight - pane.scrollTop - pane.clientHeight < 90;
    if (initial) setMessagesLoading(true);
    try {
      const response = await getChatMessages(id, { limit: 40 });
      if (selectionRef.current !== id) return;
      const recent = response.data.data || [];
      setMessages((old) => {
        if (initial) return recent;
        const merged = new Map([...old, ...recent].map((item) => [item._id, item]));
        return [...merged.values()].sort((a, b) => a._id.localeCompare(b._id));
      });
      if (initial) setHasMore(Boolean(response.data.hasMore));
      if (recent.length) {
        const readResponse = await markChatRead(id, recent[recent.length - 1]._id);
        setThreads((old) => old.map((item) => item._id === id ? { ...item, unreadCount: readResponse.data.unreadCount || 0 } : item));
        window.dispatchEvent(new Event('chat:updated'));
      }
      if (initial || nearBottom) window.requestAnimationFrame(() => {
        if (messagePaneRef.current) messagePaneRef.current.scrollTop = messagePaneRef.current.scrollHeight;
      });
    } catch (error) {
      if (selectionRef.current === id) {
        if ([403, 404].includes(error.response?.status)) {
          setSelectedId('');
          setSelectedContact(null);
          setMessages([]);
        }
        setNotice(errorText(error, 'Không thể tải tin nhắn.'));
      }
    } finally {
      if (initial && selectionRef.current === id) setMessagesLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      try { await Promise.all([loadThreads(), loadContacts()]); }
      catch (error) { setNotice(errorText(error, 'Không thể tải hộp thư.')); }
      finally { setLoading(false); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadThreads, loadContacts]);

  useEffect(() => {
    if (!conversationParam) return undefined;
    let cancelled = false;
    getConversationById(conversationParam).then((response) => {
      if (cancelled) return;
      setSelectedContact(response.data.data);
      setSelectedId(conversationParam);
      setNotice('');
    }).catch((error) => {
      if (cancelled) return;
      setSelectedId('');
      setSelectedContact(null);
      setNotice(errorText(error, 'Không thể mở cuộc trò chuyện.'));
    });
    return () => { cancelled = true; };
  }, [conversationParam]);

  useEffect(() => {
    if (!selectedId) return undefined;
    selectionRef.current = selectedId;
    const timer = window.setTimeout(() => loadLatest(selectedId, true), 0);
    return () => { window.clearTimeout(timer); selectionRef.current = ''; };
  }, [selectedId, loadLatest]);

  useEffect(() => {
    const timer = window.setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        await loadThreads(threadPage);
        if (selectionRef.current) await loadLatest(selectionRef.current);
      } catch { /* Lỗi tạm thời sẽ hiện ở lần thao tác kế tiếp. */ }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [loadThreads, loadLatest, threadPage]);

  const chooseThread = (item) => {
    setSelectedContact(item);
    setNotice('');
    setMessages([]);
    setEditingMessage(null); setDraft('');
    setSelectedId(item._id);
    setSearchParams({ conversation: item._id });
  };

  const chooseContact = async (item) => {
    setNotice('');
    try {
      const response = await openConversation({ userId: item.userId, studentId: item.studentId });
      const id = response.data.data._id;
      setSelectedContact({
        _id: id,
        otherUser: { _id: item.userId, profile: { fullName: item.fullName } },
        student: { _id: item.studentId, fullName: item.studentName, className: item.className }
      });
      setMessages([]);
      setEditingMessage(null); setDraft('');
      setSelectedId(id);
      setActiveTab('conversations');
      setSearchParams({ conversation: id });
      await loadThreads();
    } catch (error) { setNotice(errorText(error, 'Không thể mở cuộc trò chuyện.')); }
  };

  const loadOlder = async () => {
    if (!selectedId || !messages.length) return;
    try {
      const response = await getChatMessages(selectedId, { before: messages[0]._id, limit: 40 });
      setMessages((old) => [...(response.data.data || []), ...old]);
      setHasMore(Boolean(response.data.hasMore));
    } catch (error) { setNotice(errorText(error, 'Không thể tải tin nhắn cũ.')); }
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!selectedId || !draft.trim() || sending) return;
    setSending(true); setNotice('');
    try {
      const response = editingMessage
        ? await updateChatMessage(selectedId, editingMessage._id, draft.trim())
        : await sendChatMessage(selectedId, draft.trim());
      setMessages((old) => editingMessage
        ? old.map((item) => item._id === editingMessage._id ? response.data.data : item)
        : [...old, response.data.data]);
      setDraft('');
      setEditingMessage(null);
      await loadThreads();
      window.requestAnimationFrame(() => {
        if (messagePaneRef.current) messagePaneRef.current.scrollTop = messagePaneRef.current.scrollHeight;
      });
    } catch (error) { setNotice(errorText(error, 'Không thể gửi tin nhắn.')); }
    finally { setSending(false); }
  };

  const beginEdit = (message) => { setEditingMessage(message); setDraft(message.body); setNotice(''); };
  const cancelEdit = () => { setEditingMessage(null); setDraft(''); };
  const removeMessage = async (message) => {
    if (!window.confirm('Xóa tin nhắn này? Nội dung sẽ không còn hiển thị với cả hai bên.')) return;
    try {
      const response = await deleteChatMessage(selectedId, message._id);
      setMessages((old) => old.map((item) => item._id === message._id ? response.data.data : item));
      if (editingMessage?._id === message._id) cancelEdit();
      await loadThreads(threadPage);
    } catch (error) { setNotice(errorText(error, 'Không thể xóa tin nhắn.')); }
  };
  const toggleArchive = async () => {
    if (!selectedId) return;
    const archived = activeTab !== 'archived';
    try {
      await setChatArchived(selectedId, archived);
      setSelectedId(''); setSelectedContact(null); setMessages([]); setSearchParams({});
      await loadThreads(1);
      setNotice(archived ? 'Đã lưu trữ cuộc trò chuyện.' : 'Đã khôi phục cuộc trò chuyện.');
      window.dispatchEvent(new Event('chat:updated'));
    } catch (error) { setNotice(errorText(error, 'Không thể thay đổi trạng thái lưu trữ.')); }
  };

  return <AppShell title="Tin nhắn" subtitle="Trao đổi trực tiếp giữa phụ huynh và giáo viên phụ trách lớp của con.">
    <section className="chat-layout">
      <aside className="content-card chat-sidebar">
        <div className="chat-sidebar-heading"><span className="chat-icon"><Icon name="chat" size={21} /></span><div><p className="card-kicker">LIÊN LẠC NHÀ TRƯỜNG</p><h2>Hộp thư</h2></div></div>
        <div className="chat-tabs"><button className={activeTab === 'conversations' ? 'active' : ''} onClick={() => switchTab('conversations')}>Hộp thư</button><button className={activeTab === 'contacts' ? 'active' : ''} onClick={() => switchTab('contacts')}>Danh bạ</button><button className={activeTab === 'archived' ? 'active' : ''} onClick={() => switchTab('archived')}>Lưu trữ</button></div>
        {activeTab === 'contacts' && <form className="chat-search" onSubmit={(event) => { event.preventDefault(); loadContacts(1, contactSearch).catch((error) => setNotice(errorText(error, 'Không thể tìm danh bạ.'))); }}><Icon name="search" size={17} /><input value={contactSearch} onChange={(event) => setContactSearch(event.target.value)} placeholder="Tìm tên người hoặc học sinh" aria-label="Tìm danh bạ" /><button type="submit">Tìm</button></form>}
        <div className="chat-list">{loading ? <div className="inline-loader">Đang tải hộp thư...</div> : activeTab !== 'contacts' ? (
          threads.length ? threads.map((item) => <button key={item._id} className={`chat-list-item ${selectedId === item._id ? 'active' : ''} ${item.unreadCount > 0 ? 'unread' : ''}`} onClick={() => chooseThread(item)}><span className="chat-avatar">{item.otherUser?.profile?.fullName?.charAt(0) || 'N'}</span><span><strong>{item.otherUser?.profile?.fullName || 'Người dùng'}</strong><small>Về bé {item.student?.fullName || 'học sinh'}</small><em>{item.lastMessageText || 'Bắt đầu trò chuyện'}</em></span>{item.unreadCount > 0 && <span className="chat-unread-dot" aria-label={`${item.unreadCount} tin nhắn chưa đọc`} />}</button>) : <div className="chat-empty-list">Chưa có cuộc trò chuyện. Mở Danh bạ để gửi tin đầu tiên.</div>
        ) : contacts.length ? contacts.map((item) => <button key={`${item.userId}-${item.studentId}`} className="chat-list-item" onClick={() => chooseContact(item)}><span className="chat-avatar">{item.fullName.charAt(0)}</span><span><strong>{item.fullName}</strong><small>Về bé {item.studentName}</small><em>{item.className}</em></span><Icon name="chevronRight" size={16} /></button>) : <div className="chat-empty-list">Chưa có liên hệ phù hợp. Chỉ tài khoản đã liên kết con và giáo viên được phân công mới xuất hiện.</div>}</div>
        <div className="chat-pagination">{activeTab !== 'contacts' ? <><button disabled={threadPage <= 1} onClick={() => loadThreads(threadPage - 1).catch((error) => setNotice(errorText(error, 'Không thể tải trang.')))}>Trước</button><span>{threadPage}/{Math.max(1, threadTotalPages)}</span><button disabled={threadPage >= threadTotalPages} onClick={() => loadThreads(threadPage + 1).catch((error) => setNotice(errorText(error, 'Không thể tải trang.')))}>Sau ›</button></> : <><button disabled={contactPage <= 1} onClick={() => loadContacts(contactPage - 1, contactSearch).catch((error) => setNotice(errorText(error, 'Không thể tải trang.')))}>Trước</button><span>{contactPage}/{Math.max(1, contactTotalPages)}</span><button disabled={contactPage >= contactTotalPages} onClick={() => loadContacts(contactPage + 1, contactSearch).catch((error) => setNotice(errorText(error, 'Không thể tải trang.')))}>Sau ›</button></>}</div>
      </aside>
      <section className="content-card chat-room">
        {selected ? <>
          <div className="chat-room-heading"><span className="chat-avatar large">{selected.otherUser?.profile?.fullName?.charAt(0) || 'N'}</span><div><h2>{selected.otherUser?.profile?.fullName || 'Người dùng'}</h2><p>{currentUser.role === 'parent' ? 'Giáo viên' : 'Phụ huynh'} · Trao đổi về bé {selected.student?.fullName}{selected.student?.className ? ` · ${selected.student.className}` : ''}</p></div><button type="button" className="chat-archive-button" onClick={toggleArchive}>{activeTab === 'archived' ? 'Khôi phục' : 'Lưu trữ'}</button></div>
          {notice && <div className="chat-notice" role="alert">{notice}</div>}
          <div className="chat-messages" ref={messagePaneRef} aria-live="polite">{hasMore && <button className="chat-older" onClick={loadOlder}>Xem tin nhắn cũ</button>}{messagesLoading ? <div className="chat-placeholder">Đang tải tin nhắn...</div> : messages.length ? messages.map((item) => { const mine = String(item.senderId) === String(currentUser._id); return <article key={item._id} className={`chat-bubble ${mine ? 'mine' : ''} ${item.deleted ? 'deleted' : ''}`}>{item.deleted ? <p className="chat-deleted-text">Tin nhắn đã được xóa</p> : <p>{item.body}</p>}<div className="chat-message-meta"><time dateTime={item.createdAt}>{timeLabel(item.createdAt)}{item.edited ? ' · Đã chỉnh sửa' : ''}</time>{mine && !item.deleted && <span className="chat-message-actions"><button type="button" onClick={() => beginEdit(item)}>Sửa</button><button type="button" onClick={() => removeMessage(item)}>Xóa</button></span>}</div></article>; }) : <div className="chat-placeholder"><Icon name="chat" size={34} /><strong>Hãy bắt đầu cuộc trò chuyện</strong><span>Tin nhắn chỉ hiển thị với phụ huynh và giáo viên liên quan.</span></div>}</div>
          <form className={`chat-composer ${editingMessage ? 'is-editing' : ''}`} onSubmit={submit}>{editingMessage && <div className="chat-editing-banner"><span><b>Đang sửa tin nhắn</b><small>Nội dung mới sẽ hiển thị nhãn “Đã chỉnh sửa”</small></span><button type="button" onClick={cancelEdit}>Hủy</button></div>}<textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Nhập tin nhắn cho phụ huynh/giáo viên..." aria-label="Nội dung tin nhắn" maxLength={2000} rows={2} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} /><button className="button button-primary" type="submit" disabled={sending || !draft.trim()}><Icon name={editingMessage ? 'check' : 'send'} size={17} />{sending ? 'Đang lưu' : editingMessage ? 'Lưu sửa' : 'Gửi'}</button></form>
        </> : <div className="chat-placeholder chat-welcome"><Icon name="chat" size={42} /><h2>Liên lạc cùng gia đình và nhà trường</h2><p>Chọn cuộc trò chuyện có sẵn hoặc mở Danh bạ để nhắn cho người liên quan đến học sinh.</p>{notice && <span className="chat-notice" role="alert">{notice}</span>}</div>}
      </section>
    </section>
  </AppShell>;
}
