import { useCallback, useEffect, useMemo, useState } from 'react';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import {
  addAssetMaintenance,
  approveProcurementRequest,
  createAsset,
  createProcurementItem,
  createProcurementRequest,
  getAssets,
  getProcurementRequests,
  getPurchaseOrders,
  liquidateAsset
} from '../api/procurement';

const money = (value) => `${Number(value || 0).toLocaleString('vi-VN')} đ`;
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
  const [activeTab, setActiveTab] = useState('assets');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [assets, setAssets] = useState([]);
  const [requests, setRequests] = useState([]);
  const [orders, setOrders] = useState([]);
  const [showAssetModal, setShowAssetModal] = useState(false);
  const [showMaintenanceModal, setShowMaintenanceModal] = useState(false);
  const [showRequestModal, setShowRequestModal] = useState(false);
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
        getAssets(), getProcurementRequests(), getPurchaseOrders()
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
  }, []);

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

  const tabs = [
    ['assets', 'Tài sản & thiết bị', 'classes', assets.length],
    ['requests', 'Đề xuất mua sắm', 'grid', summary.pending],
    ['orders', 'Đơn đặt hàng', 'money', orders.length]
  ];

  return (
    <AppShell
      title="Cơ sở vật chất & Mua sắm"
      subtitle="Quản lý tài sản, bảo trì, đề xuất và tiến độ mua sắm của nhà trường"
      actions={<button className="button button-primary" onClick={() => activeTab === 'requests' ? setShowRequestModal(true) : setShowAssetModal(true)}><Icon name="plus" size={16} /> {activeTab === 'requests' ? 'Tạo đề xuất' : 'Thêm tài sản'}</button>}
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
            <div className="asset-panel-head"><div><p className="card-kicker">DANH MỤC TRUNG TÂM</p><h2>Tài sản & thiết bị</h2><p>Mỗi tài sản có vị trí sử dụng, trạng thái và nhật ký bảo trì riêng.</p></div><button className="button button-primary" onClick={() => setShowAssetModal(true)}><Icon name="plus" size={15} /> Thêm tài sản</button></div>
            {assets.length ? <div className="asset-table-wrap"><table className="asset-table"><thead><tr><th>TÀI SẢN</th><th>VỊ TRÍ SỬ DỤNG</th><th>NGUYÊN GIÁ</th><th>TRẠNG THÁI</th><th>BẢO TRÌ</th><th></th></tr></thead><tbody>{assets.map((asset) => { const [label, tone] = assetStatus(asset.status); return <tr key={asset._id}><td><strong>{asset.name}</strong><small>{asset.serialNumber ? `S/N: ${asset.serialNumber}` : `Nhóm: ${asset.category || 'Chưa phân loại'}`}</small></td><td><span className="asset-location">{asset.location || 'Chưa xếp vị trí'}</span></td><td><b>{money(asset.originalCost)}</b></td><td><span className={`asset-badge ${tone}`}>{label}</span></td><td><span className="maintenance-count"><b>{asset.maintenanceHistory?.length || 0}</b> lần ghi nhận</span></td><td><div className="asset-row-actions">{asset.status !== 'liquidated' && <><button onClick={() => { setSelectedAsset(asset); setShowMaintenanceModal(true); }}>Bảo trì</button><button className="danger" onClick={() => handleLiquidate(asset._id)}>Thanh lý</button></>}</div></td></tr>; })}</tbody></table></div> : <EmptyState icon="classes" title="Chưa có tài sản nào trong danh mục" text="Hãy bắt đầu bằng các tài sản đang có: điều hòa, bàn ghế, đồ chơi, thiết bị bếp hoặc máy tính." action="Thêm tài sản đầu tiên" onAction={() => setShowAssetModal(true)} />}
          </section>}

          {activeTab === 'requests' && <section className="asset-panel">
            <div className="asset-panel-head"><div><p className="card-kicker">QUY TRÌNH MUA SẮM</p><h2>Đề xuất cần xử lý</h2><p>Ghi nhận nhu cầu, ước tính ngân sách và theo dõi trạng thái phê duyệt.</p></div><button className="button button-primary" onClick={() => setShowRequestModal(true)}><Icon name="plus" size={15} /> Tạo đề xuất</button></div>
            {requests.length ? <div className="request-list">{requests.map((request) => { const [label, tone] = requestStatus(request.status); const estimate = request.items?.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.estimatedPrice || 0), 0); return <article key={request._id} className="request-card"><div className="request-card-main"><span className={`asset-badge ${tone}`}>{label}</span><h3>{request.reason}</h3><p>{request.items?.map((item) => `${item.itemName} × ${item.quantity} ${item.unit}`).join(' · ') || 'Chưa có hạng mục'}</p><small>Người đề xuất: <b>{request.requesterName || 'Chưa cập nhật'}</b> · Lập ngày {new Date(request.createdAt).toLocaleDateString('vi-VN')}</small></div><div className="request-card-side"><span>ƯỚC TÍNH</span><strong>{money(request.totalEstimatedCost || estimate)}</strong><em className={`urgency ${request.urgency}`}>{request.urgency === 'critical' ? 'Khẩn cấp' : request.urgency === 'urgent' ? 'Cần gấp' : 'Bình thường'}</em>{request.status === 'pending' && <div><button className="button button-primary" onClick={() => reviewRequest(request._id, true)}>Duyệt</button><button className="button button-secondary" onClick={() => reviewRequest(request._id, false)}>Từ chối</button></div>}</div></article>; })}</div> : <EmptyState icon="grid" title="Chưa có đề xuất mua sắm" text="Giáo viên hoặc bộ phận có thể tạo đề xuất; quản lý sẽ xem ngân sách và phê duyệt tại đây." action="Tạo đề xuất" onAction={() => setShowRequestModal(true)} />}
          </section>}

          {activeTab === 'orders' && <section className="asset-panel">
            <div className="asset-panel-head"><div><p className="card-kicker">THEO DÕI MUA HÀNG</p><h2>Đơn đặt hàng</h2><p>Các đơn đã được tạo từ đề xuất mua sắm được phê duyệt.</p></div></div>
            {orders.length ? <div className="order-grid">{orders.map((order) => <article key={order._id} className="order-card"><div><span className="order-icon"><Icon name="money" size={18} /></span><small>MÃ ĐƠN HÀNG</small><h3>{order.orderNumber || 'Đang tạo mã đơn'}</h3></div><span className="asset-badge info">{order.status || 'Đang xử lý'}</span><dl><div><dt>Ngày lập</dt><dd>{new Date(order.createdAt).toLocaleDateString('vi-VN')}</dd></div><div><dt>Tổng giá trị</dt><dd>{money(order.totalAmount)}</dd></div></dl></article>)}</div> : <EmptyState icon="money" title="Chưa có đơn đặt hàng" text="Đơn đặt hàng sẽ xuất hiện sau khi đề xuất mua sắm được phê duyệt và chuyển sang bước mua hàng." />}
          </section>}
        </>}
      </section>

      {showAssetModal && <Modal title="Ghi nhận tài sản mới" subtitle="Tạo hồ sơ để quản lý vị trí, giá trị và lịch sử sử dụng."><form className="asset-form" onSubmit={handleCreateAsset}><Field label="Tên tài sản" hint="Ví dụ: Máy điều hòa Daikin 1.5 HP"><input value={newAssetForm.name} onChange={(e) => setNewAssetForm({ ...newAssetForm, name: e.target.value })} required /></Field><div className="asset-form-grid"><Field label="Phân loại"><select value={newAssetForm.category} onChange={(e) => setNewAssetForm({ ...newAssetForm, category: e.target.value })}><option value="equipment">Thiết bị</option><option value="furniture">Nội thất</option><option value="toy">Đồ chơi</option><option value="it">Công nghệ</option><option value="stationery">Văn phòng phẩm</option></select></Field><Field label="Vị trí sử dụng" hint="Ví dụ: Lớp MGL 5-6, Bếp, Phòng y tế"><input value={newAssetForm.location} onChange={(e) => setNewAssetForm({ ...newAssetForm, location: e.target.value })} required /></Field><Field label="Nguyên giá (VNĐ)"><input type="number" min="0" value={newAssetForm.originalCost} onChange={(e) => setNewAssetForm({ ...newAssetForm, originalCost: Number(e.target.value) })} required /></Field><Field label="Số serial / mã nhận diện" hint="Không bắt buộc"><input value={newAssetForm.serialNumber} onChange={(e) => setNewAssetForm({ ...newAssetForm, serialNumber: e.target.value })} /></Field></div><ModalActions onCancel={() => setShowAssetModal(false)} submit="Lưu tài sản" /></form></Modal>}

      {showMaintenanceModal && selectedAsset && <Modal title="Ghi nhận bảo trì" subtitle={`${selectedAsset.name} · ${selectedAsset.location || 'Chưa xếp vị trí'}`}><form className="asset-form" onSubmit={handleMaintenance}><Field label="Nội dung bảo trì / sửa chữa" hint="Nêu rõ lỗi, hạng mục đã xử lý hoặc công việc cần thực hiện"><textarea rows="3" value={maintenanceForm.description} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, description: e.target.value })} required /></Field><div className="asset-form-grid"><Field label="Chi phí (VNĐ)"><input type="number" min="0" value={maintenanceForm.cost} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, cost: Number(e.target.value) })} /></Field><Field label="Đơn vị thực hiện" hint="Tên nhà cung cấp / người sửa chữa"><input value={maintenanceForm.contractor} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, contractor: e.target.value })} /></Field></div><Field label="Ghi chú" hint="Không bắt buộc"><input value={maintenanceForm.note} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, note: e.target.value })} /></Field><ModalActions onCancel={() => setShowMaintenanceModal(false)} submit="Lưu nhật ký" /></form></Modal>}

      {showRequestModal && <Modal title="Tạo đề xuất mua sắm" subtitle="Nêu rõ nhu cầu để người duyệt có đủ thông tin quyết định."><form className="asset-form" onSubmit={handleCreateRequest}><Field label="Mục đích / lý do mua sắm" hint="Ví dụ: Bổ sung ghế ngồi cho lớp MGL 5-6"><input value={newRequestForm.reason} onChange={(e) => setNewRequestForm({ ...newRequestForm, reason: e.target.value })} required /></Field><div className="asset-form-grid"><Field label="Mức độ xử lý"><select value={newRequestForm.urgency} onChange={(e) => setNewRequestForm({ ...newRequestForm, urgency: e.target.value })}><option value="normal">Bình thường</option><option value="urgent">Cần gấp</option><option value="critical">Khẩn cấp</option></select></Field><Field label="Nhóm mua sắm"><select value={newRequestForm.category} onChange={(e) => setNewRequestForm({ ...newRequestForm, category: e.target.value })}><option value="equipment">Thiết bị</option><option value="furniture">Nội thất</option><option value="toy">Đồ chơi</option><option value="it">Công nghệ</option></select></Field></div><div className="asset-form-grid"><Field label="Mặt hàng cần mua" hint="Tên mặt hàng hoặc thiết bị"><input value={newRequestForm.items[0].itemName} onChange={(e) => setNewRequestForm({ ...newRequestForm, items: [{ ...newRequestForm.items[0], itemName: e.target.value }] })} required /></Field><Field label="Số lượng"><input type="number" min="1" value={newRequestForm.items[0].quantity} onChange={(e) => setNewRequestForm({ ...newRequestForm, items: [{ ...newRequestForm.items[0], quantity: Number(e.target.value) }] })} required /></Field><Field label="Đơn vị tính"><input value={newRequestForm.items[0].unit} onChange={(e) => setNewRequestForm({ ...newRequestForm, items: [{ ...newRequestForm.items[0], unit: e.target.value }] })} required /></Field><Field label="Đơn giá dự kiến (VNĐ)"><input type="number" min="0" value={newRequestForm.items[0].estimatedPrice} onChange={(e) => setNewRequestForm({ ...newRequestForm, items: [{ ...newRequestForm.items[0], estimatedPrice: Number(e.target.value) }] })} /></Field></div><ModalActions onCancel={() => setShowRequestModal(false)} submit="Gửi đề xuất" /></form></Modal>}
    </AppShell>
  );
}

function EmptyState({ icon, title, text, action, onAction }) {
  return <div className="asset-empty"><span><Icon name={icon} size={26} /></span><h3>{title}</h3><p>{text}</p>{action && <button className="button button-primary" onClick={onAction}><Icon name="plus" size={15} /> {action}</button>}</div>;
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
