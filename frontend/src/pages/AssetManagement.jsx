import { useCallback, useEffect, useMemo, useState } from 'react';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import {
  addAssetMaintenance,
  approveProcurementRequest,
  createAsset,
  createProcurementItem,
  createProcurementRequest,
  createPurchaseOrder,
  getAssets,
  getProcurementRequests,
  getPurchaseOrders,
  getProcurementSuppliers,
  liquidateAsset,
  updatePurchaseOrderDetails,
  updatePurchaseOrderStatus
} from '../api/procurement';

const money = (value) => `${Number(value || 0).toLocaleString('vi-VN')} đ`;
const dateInputValue = (date = new Date()) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};
const deliveryDateState = (value) => {
  if (!value) return { label: 'Chưa khai báo', invalid: true };
  const date = new Date(value);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (Number.isNaN(date.getTime()) || date < today) return { label: 'Cần cập nhật', invalid: true };
  return { label: date.toLocaleDateString('vi-VN'), invalid: false };
};
const assetStatus = (status) => ({
  active: ['Đang sử dụng', 'success'],
  maintenance: ['Cần bảo trì', 'warning'],
  liquidated: ['Đã thanh lý', 'neutral'],
  broken: ['Hỏng / chờ xử lý', 'danger']
}[status] || [status || 'Chưa cập nhật', 'neutral']);
const requestStatus = (status) => ({
  pending: ['Chờ phê duyệt', 'warning'],
  approved_l1: ['Đã duyệt cấp 1', 'info'],
  approved_l2: ['Đã phê duyệt', 'success'],
  purchased: ['Đã mua', 'success'],
  rejected: ['Từ chối', 'danger']
}[status] || [status || 'Chờ phê duyệt', 'neutral']);

export default function AssetManagement() {
  const role = JSON.parse(localStorage.getItem('user') || '{}').role;
  const canManageAssets = ['admin', 'principal'].includes(role);
  const canReviewRequests = ['admin', 'principal'].includes(role);
  const [activeTab, setActiveTab] = useState(canManageAssets ? 'assets' : 'requests');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [assets, setAssets] = useState([]);
  const [requests, setRequests] = useState([]);
  const [requestPages, setRequestPages] = useState({ normal: 1, urgent: 1, critical: 1 });
  const [orders, setOrders] = useState([]);
  const [showAssetModal, setShowAssetModal] = useState(false);
  const [showMaintenanceModal, setShowMaintenanceModal] = useState(false);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [editingOrder, setEditingOrder] = useState(null);
  const [orderDraft, setOrderDraft] = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [newAssetForm, setNewAssetForm] = useState({
    itemId: '', name: '', category: 'equipment', originalCost: 5000000, location: '', serialNumber: ''
  });
  const [maintenanceForm, setMaintenanceForm] = useState({ description: '', cost: 0, contractor: '', note: '' });
  const [newRequestForm, setNewRequestForm] = useState({
    reason: '', category: 'equipment', urgency: 'normal', items: [{ itemName: '', quantity: 1, unit: 'cái', estimatedPrice: 0 }]
  });

  const feedback = (type, text) => {
    setMessage({ type, text });
    window.setTimeout(() => setMessage(null), 4500);
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [assetRes, requestRes, orderRes] = await Promise.all([
        canManageAssets ? getAssets() : Promise.resolve({ data: { data: [] } }),
        getProcurementRequests(),
        canManageAssets ? getPurchaseOrders() : Promise.resolve({ data: { data: [] } })
      ]);
      setAssets(assetRes.data.data || []);
      setRequests(requestRes.data.data || []);
      setOrders(orderRes.data.data || []);
    } catch (err) {
      console.error('Lỗi tải dữ liệu cơ sở vật chất:', err);
      feedback('error', err.response?.data?.message || 'Không thể tải dữ liệu cơ sở vật chất.');
    } finally {
      setLoading(false);
    }
  }, [canManageAssets]);

  // Initial request intentionally starts after the page mounts.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadData(); }, [loadData]);

  const summary = useMemo(() => ({
    active: assets.filter((item) => item.status === 'active').length,
    maintenance: assets.filter((item) => item.status === 'maintenance' || item.status === 'broken').length,
    pending: requests.filter((item) => item.status === 'pending' || item.status === 'approved_l1').length,
    totalValue: assets.filter((item) => item.status !== 'liquidated').reduce((sum, item) => sum + Number(item.originalCost || 0), 0),
    locations: new Set(assets.map((item) => item.location).filter(Boolean)).size
  }), [assets, requests]);

  const requestColumns = useMemo(() => ([
    { key: 'normal', label: 'Bình thường', description: 'Có thể xử lý theo kế hoạch', tone: 'normal' },
    { key: 'urgent', label: 'Cần gấp', description: 'Ưu tiên xử lý sớm', tone: 'urgent' },
    { key: 'critical', label: 'Khẩn cấp', description: 'Cần quyết định ngay', tone: 'critical' }
  ].map((column) => {
    const items = requests.filter((request) => (request.urgency || 'normal') === column.key);
    const totalPages = Math.max(1, Math.ceil(items.length / 3));
    const page = Math.min(requestPages[column.key] || 1, totalPages);
    return { ...column, items: items.slice((page - 1) * 3, page * 3), total: items.length, page, totalPages };
  })), [requests, requestPages]);

  const changeRequestPage = (urgency, page) => {
    setRequestPages((current) => ({ ...current, [urgency]: page }));
  };

  const handleCreateAsset = async (event) => {
    event.preventDefault();
    try {
      let itemId = newAssetForm.itemId;
      if (!itemId) {
        const itemRes = await createProcurementItem({
          name: newAssetForm.name, category: newAssetForm.category, unit: 'cái', defaultUnitPrice: newAssetForm.originalCost
        });
        itemId = itemRes.data.data._id;
      }
      await createAsset({ ...newAssetForm, itemId });
      setShowAssetModal(false);
      setNewAssetForm({ itemId: '', name: '', category: 'equipment', originalCost: 5000000, location: '', serialNumber: '' });
      feedback('success', 'Đã ghi nhận tài sản mới vào danh mục.');
      loadData();
    } catch (err) {
      feedback('error', err.response?.data?.message || 'Không thể thêm tài sản.');
    }
  };

  const handleMaintenance = async (event) => {
    event.preventDefault();
    try {
      await addAssetMaintenance(selectedAsset._id, maintenanceForm);
      setShowMaintenanceModal(false);
      setSelectedAsset(null);
      setMaintenanceForm({ description: '', cost: 0, contractor: '', note: '' });
      feedback('success', 'Đã lưu nhật ký bảo trì thiết bị.');
      loadData();
    } catch (err) {
      feedback('error', err.response?.data?.message || 'Không thể ghi nhận bảo trì.');
    }
  };

  const handleLiquidate = async (assetId) => {
    const reason = window.prompt('Nhập lý do thanh lý tài sản:');
    if (!reason?.trim()) return;
    try {
      await liquidateAsset(assetId, { liquidationValue: 0, reason: reason.trim(), note: 'Thanh lý theo biên bản nhà trường' });
      feedback('success', 'Tài sản đã được chuyển sang trạng thái thanh lý.');
      loadData();
    } catch (err) {
      feedback('error', err.response?.data?.message || 'Không thể thanh lý tài sản.');
    }
  };

  const handleCreateRequest = async (event) => {
    event.preventDefault();
    try {
      await createProcurementRequest(newRequestForm);
      setShowRequestModal(false);
      setNewRequestForm({ reason: '', category: 'equipment', urgency: 'normal', items: [{ itemName: '', quantity: 1, unit: 'cái', estimatedPrice: 0 }] });
      feedback('success', 'Đề xuất đã được gửi để chờ phê duyệt.');
      loadData();
    } catch (err) {
      feedback('error', err.response?.data?.message || 'Không thể gửi đề xuất mua sắm.');
    }
  };

  const reviewRequest = async (id, approved) => {
    try {
      await approveProcurementRequest(id, approved
        ? { level: 2, status: 'approved' }
        : { status: 'rejected', rejectionReason: 'Chưa phù hợp với nhu cầu hoặc ngân sách hiện tại.' });
      feedback('success', approved ? 'Đã duyệt đề xuất mua sắm.' : 'Đã từ chối đề xuất mua sắm.');
      loadData();
    } catch (err) {
      feedback('error', err.response?.data?.message || 'Không thể xử lý đề xuất.');
    }
  };

  const openOrderModal = async (request) => {
    try {
      const supplierRes = await getProcurementSuppliers();
      const activeSuppliers = supplierRes.data.data || [];
      setSuppliers(activeSuppliers);
      setOrderDraft({
        requestId: request._id,
        requestReason: request.reason,
        supplierId: '',
        supplierName: '',
        expectedDelivery: dateInputValue(new Date(Date.now() + 7 * 86400000)),
        note: '',
        items: (request.items || []).map((item) => ({ itemId: item.itemId || '', itemName: item.itemName || '', quantity: Number(item.quantity || 1), unit: item.unit || 'cái', unitPrice: Number(item.estimatedPrice || 0) }))
      });
      setShowOrderModal(true);
    } catch (err) { feedback('error', err.response?.data?.message || 'Không thể tải nhà cung cấp để lập đơn hàng.'); }
  };

  const handleCreateOrder = async (event) => {
    event.preventDefault();
    try {
      const selectedSupplier = suppliers.find((supplier) => supplier.name.trim().toLocaleLowerCase('vi-VN') === String(orderDraft.supplierName || '').trim().toLocaleLowerCase('vi-VN'));
      await createPurchaseOrder({ ...orderDraft, supplierId: selectedSupplier?._id || '' });
      setShowOrderModal(false); setOrderDraft(null); setActiveTab('orders');
      feedback('success', 'Đã tạo đơn đặt hàng và chuyển đề xuất sang trạng thái đã mua.');
      loadData();
    } catch (err) { feedback('error', err.response?.data?.message || 'Không thể tạo đơn đặt hàng.'); }
  };

  const updateOrderStatus = async (order, status) => {
    const label = status === 'delivered' ? 'đã giao' : 'đã hủy';
    if (!window.confirm(`Xác nhận chuyển đơn ${order.orderCode || ''} sang “${label}”?`)) return;
    try {
      await updatePurchaseOrderStatus(order._id, { status });
      feedback('success', `Đã cập nhật đơn hàng thành ${label}.`); loadData();
    } catch (err) { feedback('error', err.response?.data?.message || 'Không thể cập nhật trạng thái đơn hàng.'); }
  };

  const handleUpdateOrderDetails = async (event) => {
    event.preventDefault();
    try {
      await updatePurchaseOrderDetails(editingOrder._id, {
        expectedDelivery: editingOrder.expectedDelivery,
        note: editingOrder.note
      });
      setEditingOrder(null);
      feedback('success', 'Đã cập nhật ngày giao dự kiến.');
      loadData();
    } catch (err) {
      feedback('error', err.response?.data?.message || 'Không thể cập nhật ngày giao.');
    }
  };

  const tabs = canManageAssets ? [
    ['assets', 'Tài sản & thiết bị', 'classes', assets.length],
    ['requests', 'Đề xuất mua sắm', 'grid', summary.pending],
    ['orders', 'Đơn đặt hàng', 'money', orders.length]
  ] : [['requests', 'Đề xuất mua sắm của tôi', 'grid', requests.length]];

  return (
    <AppShell
      title="Cơ sở vật chất & Mua sắm"
      subtitle="Quản lý tài sản, bảo trì, đề xuất và tiến độ mua sắm của nhà trường"
      actions={activeTab === 'requests' ? <button className="button button-primary" onClick={() => setShowRequestModal(true)}><Icon name="plus" size={16} /> Tạo đề xuất</button> : canManageAssets ? <button className="button button-primary" onClick={() => setShowAssetModal(true)}><Icon name="plus" size={16} /> Thêm tài sản</button> : null}
    >
      <section className="asset-console">
        {message && <div className={`asset-feedback ${message.type}`}><Icon name={message.type === 'success' ? 'check' : 'alertCircle'} size={17} /><span>{message.text}</span><button onClick={() => setMessage(null)}>×</button></div>}

        <section className="asset-overview">
          <div className="asset-overview-copy"><p className="card-kicker">TRUNG TÂM VẬN HÀNH</p><h2>Toàn cảnh tài sản nhà trường</h2><p>Theo dõi tài sản đang sử dụng, việc bảo trì và các đề xuất cần được xử lý kịp thời.</p><div><span><b>{summary.locations}</b> vị trí quản lý</span><i /> <span><b>{assets.length}</b> tài sản đã ghi nhận</span></div></div>
          <div className="asset-overview-status"><span className={summary.maintenance ? 'has-alert' : ''}><Icon name="settings" size={20} /><b>{summary.maintenance}</b><small>thiết bị cần theo dõi</small></span><button className="button button-secondary" onClick={loadData}><Icon name="clock" size={14} /> Làm mới</button></div>
        </section>

        <section className="asset-metrics" aria-label="Tổng quan tài sản">
          <article><span className="metric-icon indigo"><Icon name="classes" size={19} /></span><div><small>TÀI SẢN ĐANG DÙNG</small><strong>{summary.active}</strong><em>đang hoạt động bình thường</em></div></article>
          <article><span className="metric-icon amber"><Icon name="settings" size={19} /></span><div><small>CẦN BẢO TRÌ</small><strong>{summary.maintenance}</strong><em>{summary.maintenance ? 'cần lên lịch xử lý' : 'chưa có việc cần xử lý'}</em></div></article>
          <article><span className="metric-icon purple"><Icon name="grid" size={19} /></span><div><small>ĐỀ XUẤT CẦN DUYỆT</small><strong>{summary.pending}</strong><em>đang chờ quyết định</em></div></article>
          <article><span className="metric-icon green"><Icon name="money" size={19} /></span><div><small>NGUYÊN GIÁ ĐANG QUẢN LÝ</small><strong>{money(summary.totalValue)}</strong><em>không gồm tài sản thanh lý</em></div></article>
        </section>

        <nav className="asset-tabs" aria-label="Các phân hệ cơ sở vật chất">
          {tabs.map(([key, label, icon, count]) => <button key={key} onClick={() => setActiveTab(key)} className={activeTab === key ? 'active' : ''}><Icon name={icon} size={17} /><span>{label}</span><b>{count}</b></button>)}
        </nav>

        {loading ? <section className="asset-panel asset-loading"><span className="loading-orb" /> Đang cập nhật dữ liệu vận hành...</section> : <>
          {activeTab === 'assets' && <section className="asset-panel">
            <div className="asset-panel-head"><div><p className="card-kicker">DANH MỤC TRUNG TÂM</p><h2>Tài sản & thiết bị</h2><p>Mỗi tài sản có vị trí sử dụng, trạng thái và nhật ký bảo trì riêng.</p></div>{canManageAssets && <button className="button button-primary" onClick={() => setShowAssetModal(true)}><Icon name="plus" size={15} /> Thêm tài sản</button>}</div>
            {assets.length ? <div className="asset-table-wrap"><table className="asset-table"><thead><tr><th>TÀI SẢN</th><th>VỊ TRÍ SỬ DỤNG</th><th>NGUYÊN GIÁ</th><th>TRẠNG THÁI</th><th>BẢO TRÌ</th><th></th></tr></thead><tbody>{assets.map((asset) => { const [label, tone] = assetStatus(asset.status); return <tr key={asset._id}><td><strong>{asset.name}</strong><small>{asset.serialNumber ? `S/N: ${asset.serialNumber}` : `Nhóm: ${asset.category || 'Chưa phân loại'}`}</small></td><td><span className="asset-location">{asset.location || 'Chưa xếp vị trí'}</span></td><td><b>{money(asset.originalCost)}</b></td><td><span className={`asset-badge ${tone}`}>{label}</span></td><td><span className="maintenance-count"><b>{asset.maintenanceHistory?.length || 0}</b> lần ghi nhận</span></td><td><div className="asset-row-actions">{asset.status !== 'liquidated' && <><button onClick={() => { setSelectedAsset(asset); setShowMaintenanceModal(true); }}>Bảo trì</button><button className="danger" onClick={() => handleLiquidate(asset._id)}>Thanh lý</button></>}</div></td></tr>; })}</tbody></table></div> : <EmptyState icon="classes" title="Chưa có tài sản nào trong danh mục" text="Hãy bắt đầu bằng các tài sản đang có: điều hòa, bàn ghế, đồ chơi, thiết bị bếp hoặc máy tính." action="Thêm tài sản đầu tiên" onAction={() => setShowAssetModal(true)} />}
          </section>}

          {activeTab === 'requests' && <section className="asset-panel">
            <div className="asset-panel-head"><div><p className="card-kicker">QUY TRÌNH MUA SẮM</p><h2>Đề xuất cần xử lý</h2><p>Ghi nhận nhu cầu, ước tính ngân sách và theo dõi trạng thái phê duyệt.</p></div><button className="button button-primary" onClick={() => setShowRequestModal(true)}><Icon name="plus" size={15} /> Tạo đề xuất</button></div>
            {requests.length ? <div className="request-board">{requestColumns.map((column) => <section className={`request-column ${column.tone}`} key={column.key}><header><div><span className="request-column-dot" /><h3>{column.label}</h3></div><b>{column.total}</b><p>{column.description}</p></header><div className="request-column-list">{column.items.length ? column.items.map((request) => <RequestCard key={request._id} request={request} canReview={canReviewRequests} canManage={canManageAssets} onReview={reviewRequest} onCreateOrder={openOrderModal} />) : <div className="request-column-empty">Chưa có đề xuất</div>}</div>{column.totalPages > 1 && <nav className="request-column-pagination"><button type="button" disabled={column.page <= 1} onClick={() => changeRequestPage(column.key, column.page - 1)}>‹</button><span>{column.page}/{column.totalPages}</span><button type="button" disabled={column.page >= column.totalPages} onClick={() => changeRequestPage(column.key, column.page + 1)}>›</button></nav>}</section>)}</div> : <EmptyState icon="grid" title="Chưa có đề xuất mua sắm" text="Giáo viên hoặc bộ phận có thể tạo đề xuất; quản lý sẽ xem ngân sách và phê duyệt tại đây." action="Tạo đề xuất" onAction={() => setShowRequestModal(true)} />}
          </section>}

          {activeTab === 'orders' && <section className="asset-panel">
            <div className="asset-panel-head"><div><p className="card-kicker">THEO DÕI MUA HÀNG</p><h2>Đơn đặt hàng</h2><p>Các đơn đã được tạo từ đề xuất mua sắm được phê duyệt.</p></div></div>
            {orders.length ? <div className="order-grid">{orders.map((order) => { const delivery = deliveryDateState(order.expectedDelivery); return <article key={order._id} className={`order-card ${delivery.invalid && order.status === 'ordered' ? 'has-invalid-date' : ''}`}><div><span className="order-icon"><Icon name="money" size={18} /></span><small>MÃ ĐƠN HÀNG</small><h3>{order.orderCode || `Đơn #${String(order._id).slice(-6).toUpperCase()}`}</h3><p>{order.supplierName || 'Chưa xác định nhà cung cấp'}</p></div><span className={`asset-badge ${order.status === 'delivered' ? 'success' : order.status === 'cancelled' ? 'danger' : 'info'}`}>{order.status === 'ordered' ? 'Đã đặt' : order.status === 'delivered' ? 'Đã giao' : order.status === 'cancelled' ? 'Đã hủy' : 'Chờ đặt'}</span><dl><div><dt>Ngày lập</dt><dd>{new Date(order.createdAt).toLocaleDateString('vi-VN')}</dd></div><div><dt>Dự kiến giao</dt><dd className={delivery.invalid ? 'invalid-date' : ''}>{delivery.label}</dd></div><div><dt>Tổng giá trị</dt><dd>{money(order.totalAmount)}</dd></div></dl>{canManageAssets && order.status === 'ordered' && <div className="order-card-actions"><button className="button button-secondary" onClick={() => setEditingOrder({ ...order, expectedDelivery: delivery.invalid ? dateInputValue(new Date(Date.now() + 7 * 86400000)) : dateInputValue(new Date(order.expectedDelivery)) })}>Sửa ngày giao</button><button className="button button-primary" onClick={() => updateOrderStatus(order, 'delivered')}>Xác nhận đã giao</button><button className="button order-cancel-button" onClick={() => updateOrderStatus(order, 'cancelled')}>Hủy đơn</button></div>}</article>; })}</div> : <EmptyState icon="money" title="Chưa có đơn đặt hàng" text="Sau khi duyệt đề xuất, mở đề xuất đó và chọn “Tạo đơn đặt hàng” để chuyển sang bước mua hàng." />}
          </section>}
        </>}
      </section>

      {showAssetModal && <Modal title="Ghi nhận tài sản mới" subtitle="Tạo hồ sơ để quản lý vị trí, giá trị và lịch sử sử dụng."><form className="asset-form" onSubmit={handleCreateAsset}><Field label="Tên tài sản" hint="Ví dụ: Máy điều hòa Daikin 1.5 HP"><input value={newAssetForm.name} onChange={(e) => setNewAssetForm({ ...newAssetForm, name: e.target.value })} required /></Field><div className="asset-form-grid"><Field label="Phân loại"><select value={newAssetForm.category} onChange={(e) => setNewAssetForm({ ...newAssetForm, category: e.target.value })}><option value="equipment">Thiết bị</option><option value="furniture">Nội thất</option><option value="toy">Đồ chơi</option><option value="it">Công nghệ</option><option value="stationery">Văn phòng phẩm</option></select></Field><Field label="Vị trí sử dụng" hint="Ví dụ: Lớp MGL 5-6, Bếp, Phòng y tế"><input value={newAssetForm.location} onChange={(e) => setNewAssetForm({ ...newAssetForm, location: e.target.value })} required /></Field><Field label="Nguyên giá (VNĐ)"><input type="number" min="0" value={newAssetForm.originalCost} onChange={(e) => setNewAssetForm({ ...newAssetForm, originalCost: Number(e.target.value) })} required /></Field><Field label="Số serial / mã nhận diện" hint="Không bắt buộc"><input value={newAssetForm.serialNumber} onChange={(e) => setNewAssetForm({ ...newAssetForm, serialNumber: e.target.value })} /></Field></div><ModalActions onCancel={() => setShowAssetModal(false)} submit="Lưu tài sản" /></form></Modal>}

      {showMaintenanceModal && selectedAsset && <Modal title="Ghi nhận bảo trì" subtitle={`${selectedAsset.name} · ${selectedAsset.location || 'Chưa xếp vị trí'}`}><form className="asset-form" onSubmit={handleMaintenance}><Field label="Nội dung bảo trì / sửa chữa" hint="Nêu rõ lỗi, hạng mục đã xử lý hoặc công việc cần thực hiện"><textarea rows="3" value={maintenanceForm.description} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, description: e.target.value })} required /></Field><div className="asset-form-grid"><Field label="Chi phí (VNĐ)"><input type="number" min="0" value={maintenanceForm.cost} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, cost: Number(e.target.value) })} /></Field><Field label="Đơn vị thực hiện" hint="Tên nhà cung cấp / người sửa chữa"><input value={maintenanceForm.contractor} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, contractor: e.target.value })} /></Field></div><Field label="Ghi chú" hint="Không bắt buộc"><input value={maintenanceForm.note} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, note: e.target.value })} /></Field><ModalActions onCancel={() => setShowMaintenanceModal(false)} submit="Lưu nhật ký" /></form></Modal>}

      {showRequestModal && <Modal title="Tạo đề xuất mua sắm" subtitle="Nêu rõ nhu cầu để người duyệt có đủ thông tin quyết định."><form className="asset-form" onSubmit={handleCreateRequest}><Field label="Mục đích / lý do mua sắm" hint="Ví dụ: Bổ sung ghế ngồi cho lớp MGL 5-6"><input value={newRequestForm.reason} onChange={(e) => setNewRequestForm({ ...newRequestForm, reason: e.target.value })} required /></Field><div className="asset-form-grid"><Field label="Mức độ xử lý"><select value={newRequestForm.urgency} onChange={(e) => setNewRequestForm({ ...newRequestForm, urgency: e.target.value })}><option value="normal">Bình thường</option><option value="urgent">Cần gấp</option><option value="critical">Khẩn cấp</option></select></Field><Field label="Nhóm mua sắm"><select value={newRequestForm.category} onChange={(e) => setNewRequestForm({ ...newRequestForm, category: e.target.value })}><option value="equipment">Thiết bị</option><option value="furniture">Nội thất</option><option value="toy">Đồ chơi</option><option value="it">Công nghệ</option></select></Field></div><div className="asset-form-grid"><Field label="Mặt hàng cần mua" hint="Tên mặt hàng hoặc thiết bị"><input value={newRequestForm.items[0].itemName} onChange={(e) => setNewRequestForm({ ...newRequestForm, items: [{ ...newRequestForm.items[0], itemName: e.target.value }] })} required /></Field><Field label="Số lượng"><input type="number" min="1" value={newRequestForm.items[0].quantity} onChange={(e) => setNewRequestForm({ ...newRequestForm, items: [{ ...newRequestForm.items[0], quantity: Number(e.target.value) }] })} required /></Field><Field label="Đơn vị tính"><input value={newRequestForm.items[0].unit} onChange={(e) => setNewRequestForm({ ...newRequestForm, items: [{ ...newRequestForm.items[0], unit: e.target.value }] })} required /></Field><Field label="Đơn giá dự kiến (VNĐ)"><input type="number" min="0" value={newRequestForm.items[0].estimatedPrice} onChange={(e) => setNewRequestForm({ ...newRequestForm, items: [{ ...newRequestForm.items[0], estimatedPrice: Number(e.target.value) }] })} /></Field></div><ModalActions onCancel={() => setShowRequestModal(false)} submit="Gửi đề xuất" /></form></Modal>}

      {showOrderModal && orderDraft && <Modal title="Tạo đơn đặt hàng" subtitle={`Đề xuất: ${orderDraft.requestReason}. Xác nhận này ghi nhận nhà trường đã đặt mua với nhà cung cấp.`}><form className="asset-form" onSubmit={handleCreateOrder}><Field label="Nhà cung cấp" hint="Chọn gợi ý đã lưu hoặc nhập trực tiếp tên nhà cung cấp mới"><input list="procurement-suppliers" value={orderDraft.supplierName} onChange={(event) => setOrderDraft({ ...orderDraft, supplierName: event.target.value })} placeholder="Ví dụ: Công ty Thiết bị Mầm Non An Phát" maxLength="160" required /><datalist id="procurement-suppliers">{suppliers.map((supplier) => <option key={supplier._id} value={supplier.name}>{supplier.phone ? `${supplier.code || ''} · ${supplier.phone}` : ''}</option>)}</datalist></Field><div className="asset-form-grid"><Field label="Ngày dự kiến giao" hint="Không được trước hôm nay hoặc quá 2 năm"><input type="date" min={dateInputValue()} value={orderDraft.expectedDelivery} onChange={(event) => setOrderDraft({ ...orderDraft, expectedDelivery: event.target.value })} required /></Field><Field label="Ghi chú đặt hàng" hint="Không bắt buộc"><input value={orderDraft.note} maxLength="500" onChange={(event) => setOrderDraft({ ...orderDraft, note: event.target.value })} placeholder="Ví dụ: Giao trong giờ hành chính" /></Field></div><div className="asset-order-items"><strong>Hạng mục đặt hàng</strong>{orderDraft.items.map((item, index) => <div className="asset-form-grid" key={`${item.itemName}-${index}`}><Field label="Mặt hàng"><input value={item.itemName} onChange={(event) => setOrderDraft({ ...orderDraft, items: orderDraft.items.map((entry, itemIndex) => itemIndex === index ? { ...entry, itemName: event.target.value } : entry) })} required /></Field><Field label="Số lượng"><input type="number" min="1" max="100000" step="1" value={item.quantity} onChange={(event) => setOrderDraft({ ...orderDraft, items: orderDraft.items.map((entry, itemIndex) => itemIndex === index ? { ...entry, quantity: Number(event.target.value) } : entry) })} required /></Field><Field label="Đơn giá chốt (VNĐ)"><input type="number" min="0" max="100000000000" value={item.unitPrice} onChange={(event) => setOrderDraft({ ...orderDraft, items: orderDraft.items.map((entry, itemIndex) => itemIndex === index ? { ...entry, unitPrice: Number(event.target.value) } : entry) })} required /></Field></div>)}</div><div className="order-total-preview"><span>Tổng giá trị đơn hàng</span><strong>{money(orderDraft.items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unitPrice || 0), 0))}</strong></div><ModalActions onCancel={() => { setShowOrderModal(false); setOrderDraft(null); }} submit="Xác nhận đã đặt hàng" /></form></Modal>}
      {editingOrder && <Modal title="Cập nhật ngày giao" subtitle={`${editingOrder.orderCode} · ${editingOrder.supplierName}`}><form className="asset-form" onSubmit={handleUpdateOrderDetails}><Field label="Ngày dự kiến giao" hint="Dùng để nhà trường theo dõi đơn đang chờ"><input type="date" min={dateInputValue()} value={editingOrder.expectedDelivery} onChange={(event) => setEditingOrder({ ...editingOrder, expectedDelivery: event.target.value })} required /></Field><Field label="Ghi chú" hint="Không bắt buộc"><textarea rows="3" maxLength="500" value={editingOrder.note || ''} onChange={(event) => setEditingOrder({ ...editingOrder, note: event.target.value })} /></Field><ModalActions onCancel={() => setEditingOrder(null)} submit="Lưu ngày giao" /></form></Modal>}
    </AppShell>
  );
}

function EmptyState({ icon, title, text, action, onAction }) {
  return <div className="asset-empty"><span><Icon name={icon} size={26} /></span><h3>{title}</h3><p>{text}</p>{action && <button className="button button-primary" onClick={onAction}><Icon name="plus" size={15} /> {action}</button>}</div>;
}

function RequestCard({ request, canReview, canManage, onReview, onCreateOrder }) {
  const [label, tone] = requestStatus(request.status);
  const estimate = request.items?.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.estimatedPrice || 0), 0);
  const itemText = request.items?.map((item) => {
    const unit = String(item.unit || '').trim() || 'sản phẩm';
    return `${item.itemName || 'Mặt hàng'} × ${item.quantity || 0} ${unit}`;
  }).join(' · ') || 'Chưa có hạng mục';

  return <article className="request-card"><div className="request-card-main"><span className={`asset-badge ${tone}`}>{label}</span><h3>{request.reason}</h3><p>{itemText}</p><small>Người đề xuất: <b>{request.requesterName || 'Chưa cập nhật'}</b></small><small>Lập ngày {new Date(request.createdAt).toLocaleDateString('vi-VN')}</small></div><div className="request-card-side"><span>ƯỚC TÍNH</span><strong>{money(request.totalEstimatedCost || estimate)}</strong>{request.status === 'pending' && (canReview ? <div><button className="button button-primary" onClick={() => onReview(request._id, true)}>Duyệt</button><button className="button button-secondary" onClick={() => onReview(request._id, false)}>Từ chối</button></div> : <small className="request-waiting-note">Chờ phê duyệt</small>)}{request.status === 'approved_l2' && canManage && <button className="button button-primary" onClick={() => onCreateOrder(request)}><Icon name="money" size={14} />Tạo đơn</button>}{request.status === 'approved_l2' && !canManage && <small className="request-waiting-note">Chờ lập đơn hàng</small>}</div></article>;
}

function Field({ label, hint, children }) {
  return <label className="asset-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

function Modal({ title, subtitle, children }) {
  return <div className="asset-modal-backdrop"><section className="asset-modal"><header><div><p className="card-kicker">CƠ SỞ VẬT CHẤT</p><h2>{title}</h2><p>{subtitle}</p></div></header>{children}</section></div>;
}

function ModalActions({ onCancel, submit }) {
  return <div className="asset-modal-actions"><button type="button" className="button button-secondary" onClick={onCancel}>Hủy</button><button className="button button-primary">{submit}</button></div>;
}
