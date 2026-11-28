import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';
import BiometricFaceCameraModal from './BiometricFaceCameraModal';
import { compressFaceImageUnder200KB } from '../utils/facePhotoCompressor';
import {
  getBiometricOverview,
  createTimekeepingDevice,
  updateTimekeepingDevice,
  deleteTimekeepingDevice,
  discoverLanTimekeepingDevices,
  checkTimekeepingDeviceCapacity,
  pullTimekeepingDeviceUsers,
  linkPulledTimekeepingUser,
  pushSmartSyncToDevice,
  syncAllTimekeepingDevicesSmart,
  pullAllTimekeepingDevicesFast,
  quickBidirectionalSyncDevices,
  quickBidirectionalSyncSingleDevice,
  pruneTimekeepingDeviceSlots,
  unlockTimekeepingDeviceDoor,
  uploadBiometricFacePhoto,
  pushSingleBiometricPerson,
  syncTimekeepingDevice,
  listPersonMappings,
  upsertPersonMapping,
  deletePersonMapping,
  getTimekeepingDeviceSyncLogs,
  getUnmappedDeviceEvents,
  simulateSchoolTimekeepingWebhook,
  getSchoolWebhookLogs,
  downloadConnectorPackageZip,
  configureTimekeepingDeviceWebhook,
  unlockDeviceSerialByVendor,
  getCampusLiveEvents
} from '../api/timekeeping';
import {
  probeLocalConnectorHealth,
  discoverLanViaLocalConnector,
  verifyDiscoveredDeviceCredentialsViaConnector,
  checkCapacityViaLocalConnector,
  pullDeviceUsersViaLocalConnector,
  pushRosterViaLocalConnector,
  updateWebhookDomainViaLocalConnector,
  pruneInactiveViaLocalConnector,
  unlockDoorViaLocalConnector
} from '../services/localLanConnectorClient';
import { toFriendlyVietnameseNotice } from '../utils/vietnameseHardwareTranslator';
import { getEmployees } from '../api/hr';
import api from '../api/axiosConfig';
import { getStoredTenant, getStoredUser } from '../utils/storage';
import './TimekeepingDeviceManagement.css';

const ALLOCATION_MODES = {
  BY_CAMPUS_PRIORITY: {
    label: 'Phân bổ theo Phân hiệu & Ưu tiên Ca trực hôm nay (Tối đa 500 slot/máy)',
    shortLabel: 'Theo Phân hiệu & Ca hôm nay (Tối ưu 500 slot)'
  },
  TODAY_ATTENDANCE_FIRST: {
    label: 'Xoay vòng Thông minh theo Ca trực hôm nay (Tự động giới hạn 500 slot)',
    shortLabel: 'Xoay vòng theo Ca hôm nay (Tối ưu 500 slot)'
  },
  ALL_ACTIVE: {
    label: 'Đồng bộ Toàn bộ Nhân sự & Học sinh đang hoạt động của trường',
    shortLabel: 'Toàn bộ hồ sơ đang hoạt động'
  }
};

const TARGET_SCOPES = {
  ALL: 'Cả Nhân sự / Giáo viên & Học sinh',
  EMPLOYEE_ONLY: 'Chỉ Nhân sự / Giáo viên',
  STUDENT_ONLY: 'Chỉ Học sinh đón trả'
};

function buildAutoDeviceCode(hostStr) {
  const clean = String(hostStr || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .split(':')[0]
    .replace(/[^a-zA-Z0-9]/g, '-')
    .toUpperCase();
  return clean ? `HIK-${clean}` : `HIK-${Date.now().toString(36).toUpperCase()}`;
}

function getDeviceStatusMeta(status) {
  if (status === 'ONLINE') {
    return { label: 'Đang kết nối tốt', cls: 'hik-status-online' };
  }
  if (status === 'AUTH_FAILED') {
    return { label: 'Chưa đúng mật khẩu máy', cls: 'hik-status-auth' };
  }
  if (status === 'OFFLINE' || status === 'ERROR') {
    return { label: 'Chưa liên lạc được máy', cls: 'hik-status-offline' };
  }
  return { label: 'Chưa kiểm tra kết nối', cls: 'hik-status-unverified' };
}

export default function TimekeepingDeviceManagement() {
  const currentUser = getStoredUser() || {};
  const storedTenant = getStoredTenant() || {};
  const isAdmin = currentUser.role === 'admin';
  const canManageSync = ['admin', 'principal', 'hr'].includes(currentUser.role);
  const canControlHardware = ['admin', 'principal'].includes(currentUser.role);
  const [isVendorSupport, setIsVendorSupport] = useState(() =>
    Boolean(currentUser.isVendorSupport || localStorage.getItem('superadmin_token'))
  );
  const [connectorHealth, setConnectorHealth] = useState({
    online: false,
    version: '',
    needsUpdate: false,
    lanIps: [],
    checking: true
  });
  const [downloadingConnector, setDownloadingConnector] = useState(false);
  const [updatingWebhookAll, setUpdatingWebhookAll] = useState(false);
  const [liveFeedEvents, setLiveFeedEvents] = useState([]);
  const [vendorSerialModalDev, setVendorSerialModalDev] = useState(null);
  const [vendorSerialForm, setVendorSerialForm] = useState({ newSerialNumber: '', targetSchoolCode: '' });
  const [savingVendorSerial, setSavingVendorSerial] = useState(false);

  // Bộ lọc Phân hiệu & Bảng danh sách khuôn mặt
  const [selectedCampus, setSelectedCampus] = useState('ALL');
  const [subjectFilter, setSubjectFilter] = useState('ALL');
  const [faceStatusFilter, setFaceStatusFilter] = useState('ALL');
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [rosterPage, setRosterPage] = useState(1);

  // Dữ liệu tổng quan từ Backend
  const [campuses, setCampuses] = useState(['Cơ sở chính']);
  const [webhookMeta, setWebhookMeta] = useState({ schoolCode: '', endpointPath: '' });
  const [kpi, setKpi] = useState({
    totalDevices: 0,
    totalSlotCapacity: 0,
    activeWithCodeCount: 0,
    activeStaffCount: 0,
    activeStudentCount: 0,
    withBiometricFaceCount: 0,
    reclaimableInactiveCount: 0
  });
  const [devices, setDevices] = useState([]);
  const [roster, setRoster] = useState([]);
  const [quickLinkCandidates, setQuickLinkCandidates] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, totalItems: 0, totalPages: 1 });

  const [loading, setLoading] = useState(true);
  const loadSeqRef = useRef(0);
  const [notice, setNotice] = useState('');
  const [noticeType, setNoticeType] = useState('info');
  const [copiedUrl, setCopiedUrl] = useState(false);

  // Phân khu hiển thị chính giúp giao diện gọn gàng, thuận tiện cho người quản lý ('devices' | 'roster' | 'webhook')
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState('devices');

  // Quét mạng LAN (Bước 1: Quét tìm thiết bị không bắt nhập mật khẩu; Bước 2: Chọn máy rồi mới nhập mật khẩu kết nối)
  const [scanningLan, setScanningLan] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanStatusText, setScanStatusText] = useState('');
  const scanTimerRef = useRef(null);
  const [lanScanResult, setLanScanResult] = useState(null);
  const [subnetPrefix, setSubnetPrefix] = useState('');
  const [connectModalTarget, setConnectModalTarget] = useState(null);
  const [connectForm, setConnectForm] = useState({
    name: '',
    location: 'Sảnh đón trẻ',
    username: 'admin',
    password: '',
    showPassword: false
  });
  const [connectModalError, setConnectModalError] = useState('');
  const [connectingDiscovered, setConnectingDiscovered] = useState(false);

  // Form Thêm / Sửa máy chấm công
  const [showDeviceForm, setShowDeviceForm] = useState(false);
  const [editingDeviceId, setEditingDeviceId] = useState(null);
  const [savingDevice, setSavingDevice] = useState(false);
  const [deviceForm, setDeviceForm] = useState({
    deviceCode: 'HIK-192-168-1-8',
    name: 'Máy chấm công Hikvision (192.168.1.8)',
    campus: 'Cơ sở chính',
    location: 'Sảnh đón trẻ Tầng 1',
    model: 'DS-K1T320MX',
    host: '192.168.1.8',
    transportScheme: 'http',
    port: 80,
    deviceUsername: 'admin',
    devicePassword: '',
    maxUserCapacity: 500,
    syncAllocationMode: 'BY_CAMPUS_PRIORITY',
    syncTargetScope: 'ALL',
    autoSyncOnChange: true
  });

  // Trạng thái thao tác nhanh toàn cụm & từng máy
  const [syncingAll, setSyncingAll] = useState(false);
  const [pullingAll, setPullingAll] = useState(false);
  const [biSyncingAll, setBiSyncingAll] = useState(false);
  const [deviceActionBusy, setDeviceActionBusy] = useState({});
  const [personActionBusy, setPersonActionBusy] = useState({});
  const [lastPullReport, setLastPullReport] = useState(null);
  const [unmatchedLinkChoice, setUnmatchedLinkChoice] = useState({});
  const [linkingExtKey, setLinkingExtKey] = useState('');
  const [cameraTarget, setCameraTarget] = useState(null);

  // Hộp xác nhận an toàn trước khi can thiệp phần cứng
  const [confirmState, setConfirmState] = useState(null);
  const [overwriteFacesOnPull, setOverwriteFacesOnPull] = useState(true);
  const [forceFullPush, setForceFullPush] = useState(false);

  // Các modal phụ trợ (Webhook Simulator, Nhật ký Webhook, Ánh xạ thủ công, Nhật ký Event Sync)
  const [activeModal, setActiveModal] = useState(null);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [students, setStudents] = useState([]);
  const [mappings, setMappings] = useState([]);
  const [mappingLoading, setMappingLoading] = useState(false);
  const [newMapping, setNewMapping] = useState({
    externalPersonId: '',
    subjectType: 'EMPLOYEE',
    subjectId: '',
    displayName: ''
  });
  const [syncLogs, setSyncLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [unmappedEvents, setUnmappedEvents] = useState([]);
  const [unmappedLoading, setUnmappedLoading] = useState(false);
  const [webhookLogs, setWebhookLogs] = useState([]);
  const [webhookLogsLoading, setWebhookLogsLoading] = useState(false);
  const [simForm, setSimForm] = useState({
    targetMode: 'STUDENT',
    externalPersonId: '',
    personName: '',
    verifyMode: 'FACE'
  });
  const [simulating, setSimulating] = useState(false);
  const [simResult, setSimResult] = useState(null);

  const resolvedSchoolCode = webhookMeta.schoolCode || storedTenant?.code || currentUser?.schoolCode || '';
  const fullWebhookUrl = resolvedSchoolCode
    ? `${window.location.origin}/api/attendance/webhook/${resolvedSchoolCode}`
    : `${window.location.origin}/api/attendance/webhook/<MA_TRUONG>`;

  const showToast = useCallback((msg, type = 'success') => {
    setNotice(msg);
    setNoticeType(type);
  }, []);

  const loadOverview = useCallback(async () => {
    const seq = loadSeqRef.current + 1;
    loadSeqRef.current = seq;
    setLoading(true);
    try {
      const res = await getBiometricOverview({
        campus: selectedCampus,
        subjectType: subjectFilter,
        faceStatus: faceStatusFilter,
        search: appliedSearch || undefined,
        page: rosterPage,
        limit: 50
      });
      if (seq !== loadSeqRef.current) return;
      const payload = res.data?.data || {};
      if (Array.isArray(payload.school?.campuses) && payload.school.campuses.length > 0) {
        setCampuses(payload.school.campuses);
      }
      if (payload.webhookMeta) {
        setWebhookMeta(payload.webhookMeta);
      }
      if (payload.sessionMeta?.isVendorSupport !== undefined) {
        setIsVendorSupport(
          Boolean(payload.sessionMeta.isVendorSupport || localStorage.getItem('superadmin_token'))
        );
      }
      if (payload.kpi) {
        setKpi(payload.kpi);
      }
      setDevices(payload.devices || []);
      setRoster(payload.roster || []);
      setQuickLinkCandidates(payload.quickLinkCandidates || []);
      if (payload.pagination) {
        setPagination(payload.pagination);
      }
    } catch (err) {
      if (seq !== loadSeqRef.current) return;
      showToast(toFriendlyVietnameseNotice(err, 'Chưa tải được danh sách máy chấm công của phân hiệu.'), 'error');
    } finally {
      if (seq === loadSeqRef.current) {
        setLoading(false);
      }
    }
  }, [selectedCampus, subjectFilter, faceStatusFilter, appliedSearch, rosterPage, showToast]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadOverview();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadOverview]);

  // Tự động kiểm tra trạng thái Cầu nối nội bộ (http://127.0.0.1:18686) trên máy tính tại trường
  const refreshConnectorHealth = useCallback(async () => {
    const res = await probeLocalConnectorHealth();
    setConnectorHealth({
      online: Boolean(res.online),
      version: res.version || '',
      needsUpdate: Boolean(res.needsUpdate),
      lanIps: res.lanIps || [],
      checking: false
    });
    return Boolean(res.online);
  }, []);

  useEffect(() => {
    const firstTimer = window.setTimeout(() => {
      void refreshConnectorHealth();
      getCampusLiveEvents(8)
        .then((r) => setLiveFeedEvents(r.data?.data || []))
        .catch(() => {});
    }, 0);
    const interval = window.setInterval(() => {
      void refreshConnectorHealth();
    }, 12000);
    return () => {
      window.clearTimeout(firstTimer);
      window.clearInterval(interval);
    };
  }, [refreshConnectorHealth]);

  // Lắng nghe sự kiện điểm danh & đồng bộ trực tiếp (SSE) của phân hiệu
  useEffect(() => {
    const onLiveEvent = (evt) => {
      const item = evt?.detail;
      if (!item?.message) return;
      setLiveFeedEvents((prev) => [item, ...prev.filter((x) => x.id !== item.id)].slice(0, 8));
    };
    window.addEventListener('hoanang:campus-live-event', onLiveEvent);
    return () => window.removeEventListener('hoanang:campus-live-event', onLiveEvent);
  }, []);

  const isPublicCloudWebOrigin = useCallback(() => {
    if (typeof window === 'undefined') return false;
    const h = String(window.location.hostname || '').toLowerCase();
    if (!h || h === 'localhost' || h === '127.0.0.1') return false;
    if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) return false;
    return true;
  }, []);

  const notifyNeedLocalConnectorOnCloud = useCallback(() => {
    showToast(
      'Máy tính bạn đang ngồi chưa bật "Bộ kết nối 1 chạm" nên trang Web trên mạng chưa nhìn thấy máy chấm công lắp trong trường. Bạn hãy bấm nút "Tải Bộ Kết Nối 1 Chạm (.zip)" ở khung phía trên, giải nén và mở tệp "1-Bat-Ket-Noi-1-Cham.bat" nhé!',
      'info'
    );
  }, [showToast]);

  const handleDownloadConnectorZip = async () => {
    if (downloadingConnector) return;
    setDownloadingConnector(true);
    try {
      const res = await downloadConnectorPackageZip();
      const blob = new Blob([res.data], { type: 'application/zip' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'HoaNang-BoKetNoiMayChamCong-1Cham.zip';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      showToast(
        'Đã tải xong "Bộ kết nối 1 chạm"! Bạn hãy giải nén tệp vừa tải và nhấp đúp vào "1-Bat-Ket-Noi-1-Cham.bat" để máy tính kết nối ngay với máy chấm công nhé.',
        'success'
      );
    } catch (err) {
      let friendlyErr = err;
      if (err?.response?.data && typeof err.response.data.text === 'function') {
        try {
          const parsedBlobJson = JSON.parse(await err.response.data.text());
          friendlyErr = { ...err, response: { ...err.response, data: parsedBlobJson } };
        } catch {
          // giữ nguyên err gốc
        }
      }
      showToast(toFriendlyVietnameseNotice(friendlyErr, 'Chưa tải được Bộ kết nối nội bộ. Bạn vui lòng bấm thử lại nhé.'), 'error');
    } finally {
      setDownloadingConnector(false);
    }
  };

  useEffect(() => {
    if (!confirmState && !activeModal && !connectModalTarget) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        setConfirmState(null);
        setActiveModal(null);
        setConnectModalTarget(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [confirmState, activeModal, connectModalTarget]);

  const ensureAuxiliaryListsLoaded = async () => {
    if (employees.length > 0 || students.length > 0) return { employees, students };
    const [empRes, stuRes] = await Promise.all([
      getEmployees().catch(() => ({ data: { data: [] } })),
      api.get('/students', { params: { limit: 300, status: 'enrolled' } }).catch(() => ({ data: { data: [] } }))
    ]);
    const empList = empRes.data?.data || [];
    const stuList = stuRes.data?.data || [];
    setEmployees(empList);
    setStudents(stuList);
    return { employees: empList, students: stuList };
  };

  useEffect(() => {
    return () => {
      if (scanTimerRef.current) {
        window.clearInterval(scanTimerRef.current);
      }
    };
  }, []);

  // ─── 1. QUÉT TỰ ĐỘNG TRONG MẠNG LAN (BƯỚC 1: QUÉT KHÔNG CẦN MẬT KHẨU -> BƯỚC 2: CHỌN MÁY RỒI NHẬP MẬT KHẨU) ───
  const handleScanLan = async () => {
    if (scanningLan) return;
    setActiveWorkspaceTab('devices');
    setScanningLan(true);
    setScanProgress(8);
    setScanStatusText('Đang kiểm tra kết nối mạng nội bộ tại máy tính trường...');

    if (scanTimerRef.current) {
      window.clearInterval(scanTimerRef.current);
    }
    scanTimerRef.current = window.setInterval(() => {
      setScanProgress((prev) => {
        if (prev >= 88) return prev;
        const next = Math.min(88, prev + (prev < 45 ? 7 : 4));
        if (next >= 25 && next < 55) {
          setScanStatusText((cur) =>
            cur.includes('192.') || cur.includes('10.') || cur.includes('172.')
              ? cur
              : 'Đang dò tìm các thiết bị chấm công đang bật trong mạng LAN của trường...'
          );
        } else if (next >= 55) {
          setScanStatusText((cur) =>
            cur.includes('192.') || cur.includes('10.') || cur.includes('172.')
              ? cur
              : 'Đang đọc thông tin dòng máy Hikvision (bạn chưa cần nhập mật khẩu ở bước này)...'
          );
        }
        return next;
      });
    }, 320);

    try {
      const rawRange = subnetPrefix.trim();
      const safeRange = rawRange && /^\d/.test(rawRange) ? rawRange : '';
      if (rawRange && !safeRange) {
        setSubnetPrefix('');
      }

      const isLocalBridgeReady = await refreshConnectorHealth();
      if (isLocalBridgeReady) {
        const bridgeOut = await discoverLanViaLocalConnector({
          subnetPrefix: safeRange,
          onProgress: (pct, msg) => {
            setScanProgress((prev) => Math.max(prev, Number(pct) || 0));
            if (msg) setScanStatusText(msg);
          }
        });
        setScanProgress(100);
        setLanScanResult(bridgeOut.data || null);
        const foundCount = bridgeOut.data?.discoveredDevices?.length || 0;
        showToast(
          foundCount > 0
            ? `Đã tìm thấy ${foundCount} máy chấm công trong mạng của trường! Bạn hãy bấm "Kết nối & Gắn vào phân hiệu" trên thiết bị bên dưới để nhập mật khẩu nhé.`
            : 'Đã quét mạng nội bộ nhưng chưa thấy máy chấm công nào đang bật. Bạn hãy kiểm tra nguồn điện và dây mạng của máy nhé.',
          foundCount > 0 ? 'success' : 'info'
        );
      } else if (isPublicCloudWebOrigin()) {
        setScanProgress(100);
        setLanScanResult({
          needsLocalConnector: true,
          scannedSubnets: [],
          discoveredDevices: []
        });
        notifyNeedLocalConnectorOnCloud();
      } else {
        setScanStatusText('Đang dò tìm thiết bị chấm công trực tiếp trên dải mạng nội bộ...');
        const res = await discoverLanTimekeepingDevices({
          subnetPrefix: safeRange || undefined
        });
        setScanProgress(100);
        const foundList = res.data?.data?.discoveredDevices || [];
        setLanScanResult(res.data?.data || null);
        if (foundList.length === 0) {
          showToast(
            'Chưa tìm thấy máy chấm công nào đang bật trong mạng nội bộ. Bạn hãy kiểm tra nguồn điện và dây mạng của máy chấm công rồi thử quét lại nhé!',
            'info'
          );
        } else {
          showToast(
            `Đã tìm thấy ${foundList.length} máy chấm công trong mạng trường! Bạn hãy bấm "Kết nối & Gắn vào phân hiệu" trên thiết bị cần dùng để nhập mật khẩu nhé.`,
            'success'
          );
        }
      }
    } catch (err) {
      showToast(toFriendlyVietnameseNotice(err, 'Chưa quét được mạng nội bộ của trường.'), 'error');
    } finally {
      if (scanTimerRef.current) {
        window.clearInterval(scanTimerRef.current);
        scanTimerRef.current = null;
      }
      setScanningLan(false);
    }
  };

  const openConnectDiscoveredModal = (item) => {
    if (item.lockedToOtherCampus) {
      showToast(
        'Chiếc máy chấm công này đang được khóa bảo mật cho một phân hiệu trường khác. Vui lòng liên hệ Kỹ thuật viên Nhà cung cấp phần mềm nếu cần chuyển máy sang phân hiệu của bạn.',
        'error'
      );
      return;
    }
    setConnectModalError('');
    setConnectModalTarget(item);
    setConnectForm({
      name: `Máy chấm công Cổng chính (${item.host})`,
      location: 'Sảnh đón trẻ',
      username: 'admin',
      password: '',
      showPassword: false
    });
  };

  const handleConfirmConnectDiscoveredDevice = async (e) => {
    e.preventDefault();
    if (!connectModalTarget || connectingDiscovered) return;
    if (!connectForm.password.trim()) {
      setConnectModalError('Bạn vui lòng nhập mật khẩu quản trị của máy chấm công để xác nhận kết nối.');
      return;
    }

    const item = connectModalTarget;
    const targetCampus = selectedCampus !== 'ALL' ? selectedCampus : (campuses[0] || 'Cơ sở chính');
    setConnectingDiscovered(true);
    setConnectModalError('');

    try {
      const bridgeUp = await refreshConnectorHealth();
      let verifiedModel = item.model || 'DS-K1T320MX';
      let verifiedSerial = item.serialNumber || '';
      let verifiedCapacity = item.maxUserCapacity || 500;

      // Xác thực mật khẩu trực tiếp với máy chấm công ngay trong mạng LAN trước khi lưu
      if (bridgeUp) {
        const inspected = await verifyDiscoveredDeviceCredentialsViaConnector({
          host: item.host,
          port: item.port || 80,
          transportScheme: item.transportScheme || 'http',
          username: connectForm.username.trim() || 'admin',
          password: connectForm.password
        });
        if (inspected?.model) verifiedModel = inspected.model;
        if (inspected?.serialNumber) verifiedSerial = inspected.serialNumber;
        if (inspected?.maxUserCapacity) verifiedCapacity = inspected.maxUserCapacity;
      }

      const cleanDeviceName = connectForm.name.trim() || `Máy chấm công (${item.host})`;
      const createRes = await createTimekeepingDevice({
        deviceCode: buildAutoDeviceCode(item.host),
        name: cleanDeviceName,
        campus: targetCampus,
        location: connectForm.location.trim() || 'Sảnh đón trẻ',
        model: verifiedModel,
        serialNumber: verifiedSerial || undefined,
        host: item.host,
        transportScheme: item.transportScheme || 'http',
        httpPort: item.transportScheme === 'http' ? (item.port || 80) : 80,
        httpsPort: item.transportScheme === 'https' ? (item.port || 443) : 443,
        maxUserCapacity: verifiedCapacity,
        syncAllocationMode: 'BY_CAMPUS_PRIORITY',
        syncTargetScope: 'ALL',
        autoSyncOnChange: true,
        deviceUsername: connectForm.username.trim() || 'admin',
        devicePassword: connectForm.password
      });

      const createdDev = createRes.data?.data;
      if (createdDev?._id) {
        if (bridgeUp) {
          const pullRes = await pullDeviceUsersViaLocalConnector(createdDev._id, false).catch(() => null);
          if (pullRes?.data) setLastPullReport(pullRes.data);
          await updateWebhookDomainViaLocalConnector(createdDev._id).catch(() => null);
        } else {
          const pullRes = await pullTimekeepingDeviceUsers(createdDev._id, false).catch(() => null);
          if (pullRes?.data?.data) setLastPullReport(pullRes.data.data);
        }
      }

      setLanScanResult((prev) =>
        prev
          ? {
              ...prev,
              discoveredDevices: (prev.discoveredDevices || []).map((d) =>
                d.host === item.host
                  ? {
                      ...d,
                      model: verifiedModel,
                      serialNumber: verifiedSerial,
                      alreadySaved: true,
                      savedCampus: targetCampus,
                      savedName: cleanDeviceName
                    }
                  : d
              )
            }
          : null
      );

      setConnectModalTarget(null);
      showToast(
        `Đã kết nối máy chấm công "${cleanDeviceName}" (${item.host}), khóa bảo mật mã phần cứng với phân hiệu và đồng bộ danh sách về phần mềm thành công!`,
        'success'
      );
      await loadOverview();
    } catch (err) {
      setConnectModalError(
        toFriendlyVietnameseNotice(
          err,
          'Mật khẩu máy chấm công chưa đúng hoặc thiết bị chưa phản hồi. Bạn vui lòng kiểm tra lại mật khẩu rồi thử lại nhé.'
        )
      );
    } finally {
      setConnectingDiscovered(false);
    }
  };

  // ─── 2. THÊM / CẬP NHẬT / XÓA THIẾT BỊ ───
  const openAddDeviceForm = () => {
    setActiveWorkspaceTab('devices');
    setEditingDeviceId(null);
    const defaultCampus = selectedCampus !== 'ALL' ? selectedCampus : (campuses[0] || 'Cơ sở chính');
    setDeviceForm({
      deviceCode: 'HIK-192-168-1-8',
      name: 'Máy chấm công Hikvision (192.168.1.8)',
      campus: defaultCampus,
      location: 'Sảnh đón trẻ Tầng 1',
      model: 'DS-K1T320MX',
      host: '192.168.1.8',
      transportScheme: 'http',
      port: 80,
      deviceUsername: 'admin',
      devicePassword: '',
      maxUserCapacity: 500,
      syncAllocationMode: 'BY_CAMPUS_PRIORITY',
      syncTargetScope: 'ALL',
      autoSyncOnChange: true
    });
    setShowDeviceForm(true);
  };

  const openEditDeviceForm = (dev) => {
    setActiveWorkspaceTab('devices');
    setEditingDeviceId(dev._id);
    const scheme = dev.transportScheme || (dev.httpsPort === 80 ? 'http' : 'https');
    setDeviceForm({
      deviceCode: dev.deviceCode || buildAutoDeviceCode(dev.host),
      name: dev.name || '',
      campus: dev.campus || 'Cơ sở chính',
      location: dev.location || 'Sảnh đón trẻ',
      model: dev.model || 'DS-K1T320MX',
      host: dev.host || '',
      transportScheme: scheme,
      port: scheme === 'http' ? (dev.httpPort || 80) : (dev.httpsPort || 443),
      deviceUsername: dev.authUsernameHint || 'admin',
      devicePassword: '',
      maxUserCapacity: dev.maxUserCapacity || 500,
      syncAllocationMode: dev.syncAllocationMode || 'BY_CAMPUS_PRIORITY',
      syncTargetScope: dev.syncTargetScope || 'ALL',
      autoSyncOnChange: dev.autoSyncOnChange !== false
    });
    setShowDeviceForm(true);
  };

  const handleSaveDevice = async (e) => {
    e.preventDefault();
    if (savingDevice) return;
    const portNum = Number(deviceForm.port);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      showToast('Cổng kết nối ISAPI phải nằm trong khoảng từ 1 đến 65535.', 'error');
      return;
    }

    setSavingDevice(true);
    try {
      const payload = {
        deviceCode: (deviceForm.deviceCode || buildAutoDeviceCode(deviceForm.host)).trim().toUpperCase(),
        name: deviceForm.name.trim(),
        campus: deviceForm.campus,
        location: deviceForm.location.trim(),
        model: deviceForm.model.trim() || 'DS-K1T320MX',
        host: deviceForm.host.trim(),
        transportScheme: deviceForm.transportScheme,
        httpPort: deviceForm.transportScheme === 'http' ? Number(deviceForm.port) || 80 : 80,
        httpsPort: deviceForm.transportScheme === 'https' ? Number(deviceForm.port) || 443 : 443,
        maxUserCapacity: Number(deviceForm.maxUserCapacity) || 500,
        syncAllocationMode: deviceForm.syncAllocationMode,
        syncTargetScope: deviceForm.syncTargetScope,
        autoSyncOnChange: deviceForm.autoSyncOnChange,
        deviceUsername: deviceForm.deviceUsername.trim() || 'admin',
        ...(deviceForm.devicePassword.trim() ? { devicePassword: deviceForm.devicePassword } : {})
      };

      if (editingDeviceId) {
        await updateTimekeepingDevice(editingDeviceId, payload);
        showToast(`Đã cập nhật cấu hình máy "${payload.name}" (${payload.campus})`, 'success');
      } else {
        const res = await createTimekeepingDevice(payload);
        const healthMsg = res.data?.health?.message ? ` — ${res.data.health.message}` : '';
        showToast(`Đã lưu máy chấm công "${payload.name}" tại ${payload.campus}${healthMsg}`, 'success');
      }

      setShowDeviceForm(false);
      setEditingDeviceId(null);
      await loadOverview();
    } catch (err) {
      showToast(toFriendlyVietnameseNotice(err, 'Chưa lưu được cấu hình máy chấm công.'), 'error');
    } finally {
      setSavingDevice(false);
    }
  };

  const confirmDeleteDevice = (dev) => {
    setConfirmState({
      tone: 'danger',
      badge: 'XÓA THIẾT BỊ KHỎI PHÂN HIỆU',
      title: `Xóa máy chấm công "${dev.name}" (${dev.host})?`,
      description: `Thiết bị đang thuộc phân hiệu "${dev.campus || 'Cơ sở chính'}" sẽ bị gỡ khỏi danh sách quản lý trên Web.`,
      bullets: [
        'Hệ thống sẽ ngừng đồng bộ hồ sơ Nhân sự & Học sinh mới xuống chiếc máy này.',
        'Dữ liệu khuôn mặt và vân tay hiện đang lưu bên trong phần cứng máy chấm công vẫn giữ nguyên.',
        'Bạn có thể quét mạng LAN để kết nối lại thiết bị bất cứ lúc nào.'
      ],
      confirmLabel: 'Xác nhận Xóa thiết bị',
      onExecute: async () => {
        await deleteTimekeepingDevice(dev._id);
        showToast(`Đã xóa máy chấm công "${dev.name}"`, 'success');
        await loadOverview();
      }
    });
  };

  // ─── 3. ĐỒNG BỘ NHANH 2 CHIỀU, KÉO/ĐẨY QUA CẦU NỐI 127.0.0.1:18686 & CẬP NHẬT TÊN MIỀN WEBHOOK 1 CHẠM ───
  const handleUpdateWebhookDomain = async (targetDev = null) => {
    const isBridgeUp = await refreshConnectorHealth();
    if (!isBridgeUp && isPublicCloudWebOrigin()) {
      notifyNeedLocalConnectorOnCloud();
      return;
    }
    if (targetDev) {
      setDeviceActionBusy((prev) => ({ ...prev, [targetDev._id]: 'webhook' }));
      try {
        let out;
        if (isBridgeUp) {
          out = await updateWebhookDomainViaLocalConnector(targetDev._id);
        } else {
          const res = await configureTimekeepingDeviceWebhook(targetDev._id, {
            clientOrigin: window.location.origin
          });
          out = res.data;
        }
        showToast(
          out?.message || `Đã cập nhật địa chỉ Web hiện tại xuống máy "${targetDev.name}" thành công!`,
          'success'
        );
        await loadOverview();
      } catch (err) {
        showToast(
          toFriendlyVietnameseNotice(
            err,
            'Chưa cập nhật được địa chỉ nhận dữ liệu xuống máy chấm công. Bạn hãy bật Bộ kết nối nội bộ trên máy tính tại trường rồi bấm lại nhé.'
          ),
          'error'
        );
      } finally {
        setDeviceActionBusy((prev) => ({ ...prev, [targetDev._id]: null }));
      }
      return;
    }

    if (devices.length === 0) return;
    setUpdatingWebhookAll(true);
    try {
      let okCount = 0;
      for (const dev of devices) {
        try {
          if (isBridgeUp) {
            await updateWebhookDomainViaLocalConnector(dev._id);
          } else {
            await configureTimekeepingDeviceWebhook(dev._id, { clientOrigin: window.location.origin });
          }
          okCount += 1;
        } catch {
          // tiếp tục các máy còn lại
        }
      }
      if (okCount > 0) {
        showToast(
          `Đã cập nhật thành công địa chỉ tên miền hiện tại (${fullWebhookUrl}) xuống ${okCount}/${devices.length} máy chấm công của phân hiệu!`,
          'success'
        );
      } else {
        showToast(
          'Chưa liên lạc được với máy chấm công để cập nhật tên miền mới. Bạn hãy bật "Bộ kết nối nội bộ" trên máy tính đặt tại trường rồi bấm lại nhé.',
          'error'
        );
      }
      await loadOverview();
    } finally {
      setUpdatingWebhookAll(false);
    }
  };

  const handleVendorSaveSerialUnlock = async (e) => {
    e.preventDefault();
    if (!vendorSerialModalDev || savingVendorSerial) return;
    setSavingVendorSerial(true);
    try {
      const res = await unlockDeviceSerialByVendor(vendorSerialModalDev._id, {
        newSerialNumber: vendorSerialForm.newSerialNumber.trim(),
        targetSchoolCode: vendorSerialForm.targetSchoolCode.trim().toUpperCase()
      });
      showToast(res.data?.message || 'Đã cập nhật khóa phần cứng thiết bị thành công!', 'success');
      setVendorSerialModalDev(null);
      await loadOverview();
    } catch (err) {
      showToast(toFriendlyVietnameseNotice(err, 'Không thể mở khóa mã phần cứng thiết bị.'), 'error');
    } finally {
      setSavingVendorSerial(false);
    }
  };

  const handleQuickBidirectionalCluster = async (targetDev = null) => {
    const isBridgeUp = await refreshConnectorHealth();
    if (!isBridgeUp && isPublicCloudWebOrigin()) {
      notifyNeedLocalConnectorOnCloud();
      return;
    }
    if (targetDev) {
      setDeviceActionBusy((prev) => ({ ...prev, [targetDev._id]: 'bisync' }));
      try {
        if (isBridgeUp) {
          const pullOut = await pullDeviceUsersViaLocalConnector(targetDev._id, false);
          const pushOut = await pushRosterViaLocalConnector(targetDev._id, { fastDelta: true });
          if (pullOut?.data) {
            setLastPullReport(pullOut.data);
          }
          showToast(
            `Đã đồng bộ 2 chiều xong với "${targetDev.name}": kéo về ${pullOut?.data?.pulledFaceCount || 0} ảnh khuôn mặt & đẩy cập nhật ${pushOut?.data?.syncedUsers || 0} hồ sơ xuống máy!`,
            'success'
          );
        } else {
          const res = await quickBidirectionalSyncSingleDevice(targetDev._id);
          const pullSummary = res.data?.data?.pullSummary;
          if (pullSummary) {
            setLastPullReport({
              deviceName: targetDev.name,
              campus: targetDev.campus,
              host: targetDev.host,
              totalOnDevice: pullSummary.matchedUsers + (pullSummary.unmatchedOnDevice?.length || 0),
              totalFacesOnDevice: pullSummary.pulledFaces,
              matchedCount: pullSummary.matchedUsers,
              pulledFaceCount: pullSummary.pulledFaces,
              eventsIngested: pullSummary.eventsIngested,
              syncedPeople: pullSummary.syncedPeople || [],
              unmatchedOnDevice: pullSummary.unmatchedOnDevice || []
            });
          }
          showToast(res.data?.message || 'Đã đồng bộ 2 chiều thành công!', 'success');
        }
        await loadOverview();
      } catch (err) {
        showToast(toFriendlyVietnameseNotice(err, 'Chưa đồng bộ 2 chiều được với máy chấm công.'), 'error');
      } finally {
        setDeviceActionBusy((prev) => ({ ...prev, [targetDev._id]: null }));
      }
      return;
    }

    setBiSyncingAll(true);
    try {
      if (isBridgeUp) {
        let pulledFaces = 0;
        let syncedMachines = 0;
        let combinedUnmatched = [];
        for (const dev of devices) {
          const pOut = await pullDeviceUsersViaLocalConnector(dev._id, false);
          await pushRosterViaLocalConnector(dev._id, { fastDelta: true });
          pulledFaces += pOut?.data?.pulledFaceCount || 0;
          combinedUnmatched = [...combinedUnmatched, ...(pOut?.data?.unmatchedOnDevice || [])];
          syncedMachines += 1;
        }
        setLastPullReport({
          deviceName: `Cụm ${syncedMachines} máy của phân hiệu`,
          campus: campuses[0] || 'Phân hiệu hiện tại',
          host: `${syncedMachines} máy`,
          matchedCount: kpi.activeWithCodeCount,
          pulledFaceCount: pulledFaces,
          unmatchedOnDevice: combinedUnmatched.slice(0, 20)
        });
        showToast(
          `Đã đồng bộ 2 chiều hoàn tất cho ${syncedMachines} máy chấm công trong mạng của trường!`,
          'success'
        );
      } else {
        const res = await quickBidirectionalSyncDevices({
          campus: selectedCampus !== 'ALL' ? selectedCampus : undefined
        });
        const pullSummary = res.data?.data?.pullSummary;
        if (pullSummary) {
          setLastPullReport({
            deviceName: selectedCampus === 'ALL' ? 'Toàn cụm máy của phân hiệu' : `Cụm máy ${selectedCampus}`,
            campus: selectedCampus === 'ALL' ? 'Phân hiệu hiện tại' : selectedCampus,
            host: `${pullSummary.pulledDevices}/${pullSummary.totalDevices} máy`,
            totalOnDevice: pullSummary.matchedUsers + (pullSummary.unmatchedOnDevice?.length || 0),
            totalFacesOnDevice: pullSummary.pulledFaces,
            matchedCount: pullSummary.matchedUsers,
            pulledFaceCount: pullSummary.pulledFaces,
            eventsIngested: pullSummary.eventsIngested,
            syncedPeople: pullSummary.syncedPeople || [],
            unmatchedOnDevice: pullSummary.unmatchedOnDevice || []
          });
        }
        showToast(res.data?.message || 'Đã đồng bộ 2 chiều toàn cụm máy!', 'success');
      }
      await loadOverview();
    } catch (err) {
      showToast(toFriendlyVietnameseNotice(err, 'Chưa đồng bộ 2 chiều được toàn cụm máy.'), 'error');
    } finally {
      setBiSyncingAll(false);
    }
  };

  const handlePullAllFastFromCluster = async () => {
    setPullingAll(true);
    try {
      const isBridgeUp = await refreshConnectorHealth();
      if (!isBridgeUp && isPublicCloudWebOrigin()) {
        notifyNeedLocalConnectorOnCloud();
        return;
      }
      if (isBridgeUp) {
        let totalFaces = 0;
        let totalMatched = 0;
        let totalEvents = 0;
        const allUnmatched = [];
        for (const dev of devices) {
          const out = await pullDeviceUsersViaLocalConnector(dev._id, false);
          totalFaces += out?.data?.pulledFaceCount || 0;
          totalMatched += out?.data?.matchedCount || 0;
          totalEvents += out?.data?.eventsIngested || 0;
          if (Array.isArray(out?.data?.unmatchedOnDevice)) {
            allUnmatched.push(...out.data.unmatchedOnDevice);
          }
        }
        setLastPullReport({
          deviceName: `Cụm ${devices.length} máy của phân hiệu`,
          campus: campuses[0] || 'Phân hiệu',
          host: `${devices.length} máy`,
          matchedCount: totalMatched,
          pulledFaceCount: totalFaces,
          eventsIngested: totalEvents,
          unmatchedOnDevice: allUnmatched.slice(0, 25)
        });
        showToast(
          `Đã kéo thành công từ ${devices.length} máy chấm công về phần mềm: khớp ${totalMatched} hồ sơ, lưu ${totalFaces} ảnh khuôn mặt!`,
          'success'
        );
      } else {
        const res = await pullAllTimekeepingDevicesFast({
          campus: selectedCampus !== 'ALL' ? selectedCampus : undefined,
          overwriteExistingFaces: false,
          includeEvents: true
        });
        const d = res.data?.data;
        if (d) {
          setLastPullReport({
            deviceName: 'Cụm máy chấm công phân hiệu',
            campus: selectedCampus === 'ALL' ? 'Phân hiệu hiện tại' : selectedCampus,
            host: `${d.pulledDevices}/${d.totalDevices} máy`,
            totalOnDevice: d.totalMatchedUsers + (d.unmatchedOnDevice?.length || 0),
            totalFacesOnDevice: d.totalPulledFaces,
            matchedCount: d.totalMatchedUsers,
            pulledFaceCount: d.totalPulledFaces,
            eventsIngested: d.totalEventsIngested,
            syncedPeople: d.syncedPeople || [],
            unmatchedOnDevice: d.unmatchedOnDevice || []
          });
        }
        showToast(res.data?.message || 'Đã kéo xong dữ liệu từ máy chấm công về phần mềm!', 'success');
      }
      await loadOverview();
    } catch (err) {
      showToast(toFriendlyVietnameseNotice(err, 'Chưa kéo được dữ liệu từ cụm máy chấm công.'), 'error');
    } finally {
      setPullingAll(false);
    }
  };

  const handleCheckCapacity = async (dev) => {
    setDeviceActionBusy((prev) => ({ ...prev, [dev._id]: 'capacity' }));
    try {
      const isBridgeUp = await refreshConnectorHealth();
      if (!isBridgeUp && isPublicCloudWebOrigin()) {
        notifyNeedLocalConnectorOnCloud();
        return;
      }
      if (isBridgeUp) {
        const out = await checkCapacityViaLocalConnector(dev._id);
        showToast(out.message, 'success');
      } else {
        const res = await checkTimekeepingDeviceCapacity(dev._id);
        showToast(
          res.data?.message || 'Đã kiểm tra trạng thái bộ nhớ máy chấm công.',
          res.data?.success ? 'success' : 'error'
        );
      }
      await loadOverview();
    } catch (err) {
      showToast(toFriendlyVietnameseNotice(err, 'Chưa liên lạc được với máy chấm công.'), 'error');
    } finally {
      setDeviceActionBusy((prev) => ({ ...prev, [dev._id]: null }));
    }
  };

  const askPullUsersFromDevice = (dev) => {
    setOverwriteFacesOnPull(true);
    setConfirmState({
      tone: 'primary',
      mode: 'PULL_USERS',
      deviceId: dev._id,
      badge: 'KÉO NHANH TỪ MÁY CHẤM CÔNG VỀ HỆ THỐNG WEB',
      title: `Kéo Ảnh Khuôn Mặt, Hồ Sơ & Lượt Chấm Công từ "${dev.name}" (${dev.host})?`,
      description: `Hệ thống chạy đa luồng kết nối ISAPI tới máy tại "${dev.campus || 'Cơ sở chính'}" để kéo danh sách người dùng, ảnh khuôn mặt gốc (<200KB) và toàn bộ lượt chấm công lưu trong máy về Web.`,
      bullets: [
        'Tự động đối chiếu thông minh theo Bảng ánh xạ ID máy, Mã Nhân viên, Mã Học sinh hoặc Họ tên trong cùng phân hiệu.',
        'Những hồ sơ mới đăng ký trực tiếp trên máy (chưa khớp mã) sẽ hiện ngay bên dưới để bạn bấm Ghép 1 chạm.',
        'Ảnh kéo về lưu riêng vào kho "Ảnh quét mặt chấm công", tuyệt đối KHÔNG ghi đè lên Avatar hiển thị trên Web.'
      ],
      confirmLabel: 'Tiến hành Kéo nhanh về Web'
    });
  };

  const executePullFromDevice = async (deviceId, overwrite) => {
    setDeviceActionBusy((prev) => ({ ...prev, [deviceId]: 'pull' }));
    try {
      const isBridgeUp = await refreshConnectorHealth();
      if (!isBridgeUp && isPublicCloudWebOrigin()) {
        notifyNeedLocalConnectorOnCloud();
        return;
      }
      if (isBridgeUp) {
        const out = await pullDeviceUsersViaLocalConnector(deviceId, overwrite);
        setLastPullReport(out?.data || null);
        showToast(out?.message || 'Đã kéo thành công danh sách hồ sơ & ảnh khuôn mặt từ máy về phần mềm!', 'success');
      } else {
        const [userRes, eventRes] = await Promise.all([
          pullTimekeepingDeviceUsers(deviceId, overwrite),
          syncTimekeepingDevice(deviceId).catch(() => null)
        ]);
        const pullData = userRes.data?.data || {};
        const ingestedEvents = eventRes?.data?.summary?.ingested || 0;
        setLastPullReport({
          ...pullData,
          eventsIngested: ingestedEvents
        });
        showToast(
          `${userRes.data?.message || 'Đã kéo hồ sơ & ảnh khuôn mặt về phần mềm'}${
            ingestedEvents > 0 ? ` • Cập nhật thêm ${ingestedEvents} lượt điểm danh mới!` : ''
          }`,
          'success'
        );
      }
      await loadOverview();
    } catch (err) {
      showToast(toFriendlyVietnameseNotice(err, 'Chưa kéo được dữ liệu từ máy chấm công.'), 'error');
    } finally {
      setDeviceActionBusy((prev) => ({ ...prev, [deviceId]: null }));
    }
  };

  const handleQuickLinkUnmatchedUser = async (unmatchedItem) => {
    const key = `${unmatchedItem.deviceId}:${unmatchedItem.employeeNo}`;
    const chosenVal = unmatchedLinkChoice[key];
    if (!chosenVal) {
      showToast('Vui lòng chọn Nhân sự hoặc Học sinh tương ứng ở ô bên cạnh trước khi bấm Ghép.', 'info');
      return;
    }
    const [subjectType, subjectId] = chosenVal.split('::');
    setLinkingExtKey(key);
    try {
      const res = await linkPulledTimekeepingUser(unmatchedItem.deviceId, {
        externalPersonId: unmatchedItem.employeeNo,
        subjectType,
        subjectId,
        faceDataUrl: unmatchedItem.faceDataUrl || ''
      });
      showToast(res.data?.message || 'Đã ghép hồ sơ và lưu ảnh khuôn mặt thành công!', 'success');
      setLastPullReport((prev) =>
        prev
          ? {
              ...prev,
              matchedCount: (prev.matchedCount || 0) + 1,
              unmatchedOnDevice: (prev.unmatchedOnDevice || []).filter(
                (u) => !(u.deviceId === unmatchedItem.deviceId && u.employeeNo === unmatchedItem.employeeNo)
              )
            }
          : null
      );
      await loadOverview();
    } catch (err) {
      showToast(err.response?.data?.message || 'Lỗi khi ghép hồ sơ từ máy chấm công', 'error');
    } finally {
      setLinkingExtKey('');
    }
  };

  const askPushSync = (devOrNull = null) => {
    const isSingle = Boolean(devOrNull);
    setForceFullPush(false);
    const scopeName = isSingle
      ? `máy "${devOrNull.name}" (${devOrNull.campus} • ${devOrNull.host})`
      : selectedCampus !== 'ALL'
        ? `tất cả máy chấm công thuộc phân hiệu "${selectedCampus}"`
        : `tất cả ${devices.length} máy chấm công của trường`;

    setConfirmState({
      tone: 'primary',
      mode: 'PUSH_SYNC',
      targetDevice: devOrNull,
      badge: 'ĐẨY ĐỒNG BỘ NHANH (WEB -> MÁY CHẤM CÔNG HIKVISION)',
      title: `Đẩy nhanh dữ liệu Nhân sự, Học sinh & Khuôn mặt xuống ${scopeName}?`,
      description: `Cơ chế Delta Sync song song tự động nhận diện thay đổi trong ${kpi.activeWithCodeCount} hồ sơ (${kpi.withBiometricFaceCount} ảnh quét mặt <200KB) để nạp cực nhanh và không vượt 500 slot/máy.`,
      bullets: [
        'Mặc định Chế độ Nhanh (Delta): Chỉ đẩy hồ sơ mới hoặc người vừa đổi tên/ảnh mặt, bỏ qua ghi thừa qua mạng.',
        'Hồ sơ chưa có ảnh mặt trên Web: Giữ nguyên 100% vân tay, thẻ từ và khuôn mặt gốc đã quét trực tiếp tại máy.',
        'Tuyệt đối KHÔNG tự ý xóa dữ liệu hiện có trên máy chấm công.'
      ],
      confirmLabel: isSingle ? 'Đẩy nhanh xuống máy này' : 'Đẩy nhanh xuống toàn cụm'
    });
  };

  const executePushSync = async (devOrNull, forceFull) => {
    const isBridgeUp = await refreshConnectorHealth();
    if (!isBridgeUp && isPublicCloudWebOrigin()) {
      notifyNeedLocalConnectorOnCloud();
      return;
    }
    if (devOrNull) {
      setDeviceActionBusy((prev) => ({ ...prev, [devOrNull._id]: 'push' }));
      try {
        if (isBridgeUp) {
          const out = await pushRosterViaLocalConnector(devOrNull._id, {
            fastDelta: !forceFull,
            forceFullSync: Boolean(forceFull)
          });
          showToast(out?.message || 'Đã đẩy khuôn mặt học sinh & nhân sự xuống máy chấm công thành công!', 'success');
        } else {
          const res = await pushSmartSyncToDevice(devOrNull._id, {
            fastDelta: !forceFull,
            forceFullSync: Boolean(forceFull)
          });
          showToast(res.data?.message || 'Đã đẩy đồng bộ xuống máy chấm công!', 'success');
        }
        await loadOverview();
      } catch (err) {
        showToast(toFriendlyVietnameseNotice(err, 'Chưa đẩy được khuôn mặt xuống máy chấm công.'), 'error');
      } finally {
        setDeviceActionBusy((prev) => ({ ...prev, [devOrNull._id]: null }));
      }
    } else {
      setSyncingAll(true);
      try {
        if (isBridgeUp) {
          let totalSynced = 0;
          for (const dev of devices) {
            await pushRosterViaLocalConnector(dev._id, {
              fastDelta: !forceFull,
              forceFullSync: Boolean(forceFull)
            });
            totalSynced += 1;
          }
          showToast(
            `Đã đồng bộ thành công danh sách học sinh & ảnh khuôn mặt xuống cả ${totalSynced} máy chấm công của phân hiệu!`,
            'success'
          );
        } else {
          const res = await syncAllTimekeepingDevicesSmart({
            campus: selectedCampus !== 'ALL' ? selectedCampus : undefined,
            fastDelta: !forceFull,
            forceFullSync: Boolean(forceFull)
          });
          showToast(res.data?.message || 'Đã đẩy đồng bộ tới toàn bộ cụm máy!', 'success');
        }
        await loadOverview();
      } catch (err) {
        showToast(toFriendlyVietnameseNotice(err, 'Chưa đồng bộ được xuống cụm máy chấm công.'), 'error');
      } finally {
        setSyncingAll(false);
      }
    }
  };

  const askPruneDevice = (dev) => {
    setConfirmState({
      tone: 'danger',
      badge: 'DỌN BỘ NHỚ MÁY CHẤM CÔNG — XÓA HỒ SƠ ĐÃ NGHỈ',
      title: `Giải phóng bộ nhớ người đã nghỉ trên "${dev.name}" (${dev.host})?`,
      description: 'Hệ thống sẽ xóa các mã Nhân sự đã nghỉ việc và Học sinh đã ra trường/thôi học khỏi bộ nhớ của chiếc máy này.',
      bullets: [
        `Giải phóng ${kpi.reclaimableInactiveCount || 0} vị trí của hồ sơ đã nghỉ để dành chỗ cho học sinh mới.`,
        'Toàn bộ Nhân sự đang làm việc và Học sinh đang theo học được giữ nguyên an toàn 100%.'
      ],
      confirmLabel: 'Xác nhận Dọn bộ nhớ',
      onExecute: async () => {
        setDeviceActionBusy((prev) => ({ ...prev, [dev._id]: 'prune' }));
        try {
          const isBridgeUp = await refreshConnectorHealth();
          if (isBridgeUp) {
            const out = await pruneInactiveViaLocalConnector(dev._id);
            showToast(out.message, 'success');
          } else {
            const res = await pruneTimekeepingDeviceSlots(dev._id);
            showToast(res.data?.message || 'Đã dọn bộ nhớ hồ sơ nghỉ trên máy chấm công!', 'success');
          }
          await loadOverview();
        } finally {
          setDeviceActionBusy((prev) => ({ ...prev, [dev._id]: null }));
        }
      }
    });
  };

  const askUnlockDoor = (dev) => {
    setConfirmState({
      tone: 'warning',
      badge: 'ĐIỀU KHIỂN CỔNG TRƯỜNG — MỞ CỬA TỪ XA',
      title: `Mở chốt cửa từ xa tại "${dev.name}" (${dev.location || 'Sảnh đón trẻ'})?`,
      description: 'Máy chấm công sẽ nhả khóa điện để mở cửa đón trả trẻ ngay lập tức.',
      bullets: [
        `Vị trí cửa: ${dev.location || 'Cổng trường'} (${dev.host}).`,
        'Bạn hãy quan sát xác nhận phụ huynh hoặc giáo viên trước cửa trước khi bấm mở nhé.'
      ],
      confirmLabel: 'Xác nhận Mở cửa ngay',
      onExecute: async () => {
        setDeviceActionBusy((prev) => ({ ...prev, [dev._id]: 'door' }));
        try {
          const isBridgeUp = await refreshConnectorHealth();
          if (isBridgeUp) {
            const out = await unlockDoorViaLocalConnector(dev._id, 1);
            showToast(out.message, 'success');
          } else {
            const res = await unlockTimekeepingDeviceDoor(dev._id, 1);
            showToast(res.data?.message || 'Đã mở chốt cửa từ xa thành công!', 'success');
          }
        } finally {
          setDeviceActionBusy((prev) => ({ ...prev, [dev._id]: null }));
        }
      }
    });
  };

  const handlePullEventLogsFromMachine = async (dev) => {
    setDeviceActionBusy((prev) => ({ ...prev, [dev._id]: 'events' }));
    try {
      const res = await syncTimekeepingDevice(dev._id);
      if (res.data?.success) {
        const s = res.data.summary || {};
        showToast(
          `Đã kéo lịch sử quẹt từ "${dev.name}": ${s.ingested || 0} lượt mới, ${s.duplicate || 0} trùng, ${s.unmapped || 0} chưa map.`,
          'success'
        );
      } else {
        showToast(res.data?.message || 'Chưa kéo được sự kiện từ máy', 'info');
      }
      await loadOverview();
    } catch (err) {
      showToast(err.response?.data?.message || 'Lỗi kéo sự kiện chấm công từ máy', 'error');
    } finally {
      setDeviceActionBusy((prev) => ({ ...prev, [dev._id]: null }));
    }
  };

  // ─── 4. UPLOAD ẢNH QUÉT MẶT (<200KB) & ĐẨY TỪNG CÁ NHÂN ───
  const handleFileUploadForPerson = async (person, e) => {
    const rawFile = e.target?.files?.[0];
    if (!rawFile) return;
    e.target.value = '';

    const busyKey = `${person.subjectType}:${person.subjectId}`;
    setPersonActionBusy((prev) => ({ ...prev, [busyKey]: 'upload' }));
    try {
      const compressed = await compressFaceImageUnder200KB(
        rawFile,
        `${person.personCode}_face.jpg`
      );
      const res = await uploadBiometricFacePhoto(person.subjectType, person.subjectId, {
        imageBase64: compressed.dataUrl,
        source: 'UPLOAD'
      });
      showToast(res.data?.message || `Đã nén & lưu ảnh mặt (${compressed.compressedSizeKB} KB < 200 KB)!`, 'success');
      await loadOverview();
    } catch (err) {
      showToast(err.response?.data?.message || err.message || 'Lỗi tải ảnh khuôn mặt chấm công', 'error');
    } finally {
      setPersonActionBusy((prev) => ({ ...prev, [busyKey]: null }));
    }
  };

  const handleSaveFromCameraModal = async (compressedInfo) => {
    if (!cameraTarget) return;
    const res = await uploadBiometricFacePhoto(cameraTarget.subjectType, cameraTarget.subjectId, {
      imageBase64: compressedInfo.dataUrl,
      source: compressedInfo.source || 'CAMERA'
    });
    showToast(res.data?.message || 'Đã chụp & lưu ảnh khuôn mặt chuẩn Hikvision (<200KB)!', 'success');
    await loadOverview();
  };

  const handlePushSinglePerson = async (person) => {
    const busyKey = `${person.subjectType}:${person.subjectId}`;
    setPersonActionBusy((prev) => ({ ...prev, [busyKey]: 'push' }));
    try {
      const isBridgeUp = await refreshConnectorHealth();
      if (isBridgeUp && devices.length > 0) {
        let pushedCount = 0;
        let lastMsg = '';
        for (const dev of devices) {
          const out = await pushRosterViaLocalConnector(dev._id, {
            fastDelta: false,
            forceFullSync: true,
            subjectType: person.subjectType,
            subjectId: person.subjectId
          });
          pushedCount += 1;
          lastMsg = out?.message || '';
        }
        showToast(
          lastMsg || `Đã đẩy khuôn mặt của "${person.fullName}" xuống ${pushedCount} máy chấm công của phân hiệu!`,
          'success'
        );
      } else {
        const res = await pushSingleBiometricPerson(person.subjectType, person.subjectId);
        showToast(res.data?.message || `Đã đẩy "${person.fullName}" xuống máy chấm công!`, 'success');
      }
      await loadOverview();
    } catch (err) {
      showToast(
        toFriendlyVietnameseNotice(err, `Chưa đẩy được khuôn mặt của "${person.fullName}" xuống máy chấm công.`),
        'error'
      );
    } finally {
      setPersonActionBusy((prev) => ({ ...prev, [busyKey]: null }));
    }
  };

  // ─── 5. WEBHOOK & MODAL PHỤ TRỢ ───
  const handleCopyWebhookUrl = async () => {
    try {
      await navigator.clipboard.writeText(fullWebhookUrl);
      setCopiedUrl(true);
      window.setTimeout(() => setCopiedUrl(false), 2200);
    } catch {
      // ignore clipboard error
    }
  };

  const openWebhookSimulator = async () => {
    const lists = await ensureAuxiliaryListsLoaded();
    const firstStu = lists.students[0];
    const firstEmp = lists.employees[0];
    setSimResult(null);
    setSimForm({
      targetMode: firstStu ? 'STUDENT' : 'EMPLOYEE',
      externalPersonId: firstStu?.studentCode || firstEmp?.employeeCode || roster[0]?.personCode || '',
      personName: firstStu?.fullName || firstEmp?.fullName || roster[0]?.fullName || '',
      verifyMode: 'FACE'
    });
    setActiveModal('simulate_webhook');
  };

  const openWebhookLogs = async () => {
    setActiveModal('webhook_logs');
    setWebhookLogsLoading(true);
    try {
      const res = await getSchoolWebhookLogs({ page: 1, limit: 30 });
      setWebhookLogs(res.data?.data || []);
    } catch {
      setWebhookLogs([]);
    } finally {
      setWebhookLogsLoading(false);
    }
  };

  const handleRunWebhookSimulation = async (e) => {
    e.preventDefault();
    if (!simForm.externalPersonId.trim() || simulating) return;
    setSimulating(true);
    setSimResult(null);
    try {
      const res = await simulateSchoolTimekeepingWebhook({
        externalPersonId: simForm.externalPersonId.trim(),
        personName: simForm.personName.trim(),
        verifyMode: simForm.verifyMode
      });
      setSimResult(res.data?.data || null);
      showToast(res.data?.message || 'Đã gửi gói tin kiểm tra Webhook thành công!', 'success');
    } catch (err) {
      showToast(err.response?.data?.message || 'Lỗi khi giả lập gói tin Webhook', 'error');
    } finally {
      setSimulating(false);
    }
  };

  const openMappingsModal = async (dev) => {
    setSelectedDevice(dev);
    setActiveModal('mappings');
    setMappingLoading(true);
    try {
      const [mapRes, lists] = await Promise.all([
        listPersonMappings(dev._id),
        ensureAuxiliaryListsLoaded()
      ]);
      setMappings(mapRes.data?.data || []);
      const firstUid = lists.employees[0]?.userId?._id || lists.employees[0]?.userId || '';
      setNewMapping({
        externalPersonId: '',
        subjectType: 'EMPLOYEE',
        subjectId: firstUid,
        displayName: ''
      });
    } catch {
      setMappings([]);
    } finally {
      setMappingLoading(false);
    }
  };

  const handleSaveMapping = async (e) => {
    e.preventDefault();
    if (!selectedDevice || !newMapping.externalPersonId || !newMapping.subjectId) return;
    try {
      await upsertPersonMapping(selectedDevice._id, newMapping);
      const res = await listPersonMappings(selectedDevice._id);
      setMappings(res.data?.data || []);
      setNewMapping((prev) => ({ ...prev, externalPersonId: '', displayName: '' }));
      showToast('Đã lưu ánh xạ ID máy thành công!', 'success');
    } catch (err) {
      showToast(err.response?.data?.message || 'Lỗi lưu ánh xạ ID', 'error');
    }
  };

  const handleRemoveMapping = async (mappingId) => {
    if (!selectedDevice) return;
    try {
      await deletePersonMapping(selectedDevice._id, mappingId);
      setMappings((prev) => prev.filter((m) => m._id !== mappingId));
    } catch (err) {
      showToast(err.response?.data?.message || 'Không thể xóa ánh xạ', 'error');
    }
  };

  const openDeviceLogsModal = async (dev) => {
    setSelectedDevice(dev);
    setActiveModal('logs');
    setLogsLoading(true);
    try {
      const res = await getTimekeepingDeviceSyncLogs(dev._id);
      setSyncLogs(res.data?.data || []);
    } catch {
      setSyncLogs([]);
    } finally {
      setLogsLoading(false);
    }
  };

  const openUnmappedModal = async (dev) => {
    setSelectedDevice(dev);
    setActiveModal('unmapped');
    setUnmappedLoading(true);
    try {
      const res = await getUnmappedDeviceEvents(dev.deviceCode);
      setUnmappedEvents(res.data?.data || []);
    } catch {
      setUnmappedEvents([]);
    } finally {
      setUnmappedLoading(false);
    }
  };

  return (
    <div className="hik-sync-workspace">
      {notice && (
        <div
          className={`hik-alert hik-fade-in ${
            noticeType === 'error'
              ? 'hik-alert-error'
              : noticeType === 'success'
                ? 'hik-alert-success'
                : 'hik-alert-info'
          }`}
        >
          <span>{notice}</span>
          <button type="button" className="hik-alert-close" onClick={() => setNotice('')} aria-label="Đóng thông báo">
            <Icon name="close" size={14} />
          </button>
        </div>
      )}

      {/* ─── DẢI TRẠNG THÁI CẦU NỐI NỘI BỘ 127.0.0.1:18686 TẠI MÁY TÍNH PHÂN HIỆU ─── */}
      <section
        className={`hik-connector-banner ${
          connectorHealth.online && !connectorHealth.needsUpdate ? 'online' : 'offline'
        }`}
      >
        <div style={{ flex: '1 1 420px', minWidth: 0 }}>
          {connectorHealth.online && !connectorHealth.needsUpdate ? (
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 10px' }}>
              <span style={{ fontWeight: 800, fontSize: 13, display: 'inline-flex', alignItems: 'center' }}>
                <span className="hik-inline-dot" />
                <span>
                  Máy tính đã nối thông mạng nội bộ trường ({connectorHealth.lanIps.join(', ') || 'Sẵn sàng'} · v{connectorHealth.version})
                </span>
              </span>
              <span style={{ fontSize: 12.5, color: '#475569' }}>
                • Khóa bảo mật phần cứng theo phân hiệu <strong>{resolvedSchoolCode || 'hiện tại'}</strong>
              </span>
            </div>
          ) : connectorHealth.online && connectorHealth.needsUpdate ? (
            <>
              <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 2, display: 'flex', alignItems: 'center' }}>
                <span className="hik-inline-dot amber" />
                <span>
                  Bộ kết nối trên máy tính này đang ở bản cũ (v{connectorHealth.version || '2.0.0'}) — Hãy cập nhật để quét đủ tất cả máy chấm công trong mạng!
                </span>
              </div>
              <div style={{ fontSize: 12.5 }}>
                Bấm <strong>&ldquo;Cập Nhật Bộ Kết Nối 1 Chạm (.zip)&rdquo;</strong> bên phải, giải nén và mở tệp <code>1-Bat-Ket-Noi-1-Cham.bat</code> (tệp này sẽ tự đóng bản cũ và bật bản mới <code>v2.2.0</code> nhận diện 100% máy chấm công).
              </div>
            </>
          ) : (
            <>
              <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 2, display: 'flex', alignItems: 'center' }}>
                <span className="hik-inline-dot amber" />
                <span>
                  Để quét và đồng bộ máy chấm công lắp trong mạng trường, hãy bật &ldquo;Bộ kết nối 1 chạm&rdquo; trên máy tính này
                </span>
              </div>
              <div style={{ fontSize: 12.5 }}>
                Lần đầu sử dụng trên máy tính văn phòng trường, bạn bấm <strong>&ldquo;Tải Bộ Kết Nối 1 Chạm&rdquo;</strong>, giải nén và mở tệp <code>1-Bat-Ket-Noi-1-Cham.bat</code> (tự khởi động cùng Windows và tự nhận mọi tên miền mới).
              </div>
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            className="hik-btn hik-btn-secondary hik-btn-sm"
            disabled={connectorHealth.checking}
            onClick={() => refreshConnectorHealth()}
          >
            <Icon name="refresh" size={13} className={connectorHealth.checking ? 'hik-spin' : ''} />
            <span>{connectorHealth.checking ? 'Đang kiểm tra...' : 'Kiểm tra kết nối'}</span>
          </button>
          <button
            type="button"
            className={`hik-btn ${
              connectorHealth.online && !connectorHealth.needsUpdate ? 'hik-btn-secondary' : 'hik-btn-primary'
            } hik-btn-sm`}
            disabled={downloadingConnector}
            onClick={handleDownloadConnectorZip}
          >
            <Icon name={downloadingConnector ? 'refresh' : 'download'} size={13} className={downloadingConnector ? 'hik-spin' : ''} />
            <span>
              {downloadingConnector
                ? 'Đang đóng gói...'
                : connectorHealth.needsUpdate
                  ? 'Cập Nhật Bộ Kết Nối 1 Chạm (.zip)'
                  : 'Tải Bộ Kết Nối 1 Chạm (.zip)'}
            </span>
          </button>
        </div>
      </section>

      {/* ─── 4 THẺ CHỈ SỐ TỔNG QUAN PHÂN HIỆU (LUÔN HIỂN THỊ GỌN TRÊN ĐẦU TRANG) ─── */}
      <div className="hik-kpi-grid">
        <div
          className="hik-kpi-card hik-kpi-slate"
          style={{ cursor: 'pointer' }}
          onClick={() => setActiveWorkspaceTab('devices')}
          role="presentation"
        >
          <p className="hik-kpi-label">Thiết bị chấm công tại trường</p>
          <p className="hik-kpi-value">
            {kpi.totalDevices} máy ({kpi.totalSlotCapacity} vị trí)
          </p>
          <p className="hik-kpi-sub">
            {selectedCampus === 'ALL' ? `Phân hiệu: ${storedTenant?.name || campuses[0] || 'Toàn trường'}` : `Cơ sở: ${selectedCampus}`}
          </p>
        </div>

        <div
          className="hik-kpi-card hik-kpi-indigo"
          style={{ cursor: 'pointer' }}
          onClick={() => setActiveWorkspaceTab('roster')}
          role="presentation"
        >
          <p className="hik-kpi-label">Nhân sự &amp; Học sinh hoạt động</p>
          <p className="hik-kpi-value">{kpi.activeWithCodeCount} / 500 vị trí mỗi máy</p>
          <p className="hik-kpi-sub">
            {kpi.activeStaffCount} nhân sự • {kpi.activeStudentCount} học sinh đang học
          </p>
        </div>

        <div
          className="hik-kpi-card hik-kpi-emerald"
          style={{ cursor: 'pointer' }}
          onClick={() => setActiveWorkspaceTab('roster')}
          role="presentation"
        >
          <p className="hik-kpi-label">Hồ sơ đã có ảnh khuôn mặt</p>
          <p className="hik-kpi-value">{kpi.withBiometricFaceCount} ảnh khuôn mặt</p>
          <p className="hik-kpi-sub">Chân dung rõ mặt, tự động căn chỉnh chuẩn</p>
        </div>

        <div
          className="hik-kpi-card hik-kpi-rose"
          style={{ cursor: 'pointer' }}
          onClick={() => setActiveWorkspaceTab('devices')}
          role="presentation"
        >
          <p className="hik-kpi-label">Nghỉ việc / Thôi học (Dọn bộ nhớ)</p>
          <p className="hik-kpi-value">{kpi.reclaimableInactiveCount} vị trí có thể thu hồi</p>
          <p className="hik-kpi-sub">Sẵn sàng giải phóng khỏi bộ nhớ máy</p>
        </div>
      </div>

      {/* ─── THANH ĐIỀU HƯỚNG 3 PHÂN KHU RÕ RÀNG CHO NGƯỜI QUẢN LÝ ─── */}
      <nav className="hik-workspace-tabs" aria-label="Phân khu quản lý máy chấm công">
        <button
          type="button"
          className={`hik-workspace-tab ${activeWorkspaceTab === 'devices' ? 'active' : ''}`}
          onClick={() => setActiveWorkspaceTab('devices')}
        >
          <Icon name="server" size={15} />
          <span>Thiết bị &amp; Đồng bộ Mạng Trường</span>
          <span className="hik-tab-badge">{devices.length}</span>
        </button>

        <button
          type="button"
          className={`hik-workspace-tab ${activeWorkspaceTab === 'roster' ? 'active' : ''}`}
          onClick={() => setActiveWorkspaceTab('roster')}
        >
          <Icon name="camera" size={15} />
          <span>Ảnh Khuôn Mặt Học Sinh &amp; Nhân Sự</span>
          <span className="hik-tab-badge">{pagination.totalItems}</span>
        </button>

        <button
          type="button"
          className={`hik-workspace-tab ${activeWorkspaceTab === 'webhook' ? 'active' : ''}`}
          onClick={() => setActiveWorkspaceTab('webhook')}
        >
          <Icon name="bell" size={15} />
          <span>Nhận Điểm Danh Tự Động &amp; Nhật Ký</span>
          {liveFeedEvents.length > 0 && <span className="hik-tab-badge">{liveFeedEvents.length}</span>}
        </button>
      </nav>

      {/* ═══════════════════════════════════════════════════════════════════════════════
          PHÂN KHU 1: THIẾT BỊ CHẤM CÔNG, QUÉT MẠNG LAN & ĐỒNG BỘ 2 CHIỀU
         ═══════════════════════════════════════════════════════════════════════════════ */}
      {activeWorkspaceTab === 'devices' && (
        <>
          <section className="hik-hero-card hik-fade-in">
            <div className="hik-cluster-toolbar">
              <div className="hik-hero-title-group">
                <div className="hik-hero-heading-row">
                  <h2>Máy Chấm Công &amp; Đồng Bộ Dữ Liệu Phân Hiệu</h2>
                  <span className="hik-pill-discovery">Khóa bảo mật riêng theo Phân hiệu</span>
                </div>
                <p className="hik-hero-subtitle">
                  Quét tìm máy chấm công trong mạng nội bộ, kéo ảnh khuôn mặt &amp; lượt điểm danh về Web hoặc đẩy danh sách học sinh, nhân sự xuống máy của trường.
                </p>
              </div>

              {/* Thanh nút bấm phân nhóm hợp lý: Nhóm Khai báo/Quét mạng | Nhóm Đồng bộ (chỉ hiện khi đã có máy) */}
              <div className="hik-toolbar-groups">
                <div className="hik-toolbar-group">
                  {canManageSync && (
                    <button
                      type="button"
                      className={`hik-btn ${devices.length === 0 ? 'hik-btn-primary' : 'hik-btn-secondary'}`}
                      disabled={scanningLan}
                      onClick={handleScanLan}
                    >
                      <Icon
                        name={scanningLan ? 'refresh' : 'radar'}
                        size={15}
                        className={scanningLan ? 'hik-spin' : ''}
                      />
                      <span>
                        {scanningLan ? `Đang quét mạng (${scanProgress}%)...` : 'Quét tìm máy trong mạng'}
                      </span>
                    </button>
                  )}

                  {isAdmin && (
                    <button
                      type="button"
                      className="hik-btn hik-btn-secondary"
                      onClick={() => {
                        if (showDeviceForm && !editingDeviceId) {
                          setShowDeviceForm(false);
                        } else {
                          openAddDeviceForm();
                        }
                      }}
                    >
                      <Icon name="plus" size={15} />
                      <span>{showDeviceForm && !editingDeviceId ? 'Đóng biểu mẫu' : 'Thêm thủ công'}</span>
                    </button>
                  )}
                </div>

                {canManageSync && devices.length > 0 && (
                  <>
                    <span className="hik-toolbar-divider" aria-hidden="true" />
                    <div className="hik-toolbar-group">
                      <button
                        type="button"
                        className="hik-btn hik-btn-secondary"
                        disabled={pullingAll || syncingAll || biSyncingAll}
                        onClick={handlePullAllFastFromCluster}
                        title="Kéo ảnh khuôn mặt & lượt chấm công từ tất cả máy về phần mềm"
                      >
                        <Icon
                          name={pullingAll ? 'refresh' : 'download'}
                          size={15}
                          className={pullingAll ? 'hik-spin' : ''}
                        />
                        <span>{pullingAll ? 'Đang kéo về Web...' : 'Kéo về Web'}</span>
                      </button>

                      <button
                        type="button"
                        className="hik-btn hik-btn-secondary"
                        disabled={syncingAll || pullingAll || biSyncingAll}
                        onClick={() => askPushSync(null)}
                        title="Đẩy hồ sơ mới & ảnh khuôn mặt từ phần mềm xuống tất cả máy"
                      >
                        <Icon
                          name={syncingAll ? 'refresh' : 'upload'}
                          size={15}
                          className={syncingAll ? 'hik-spin' : ''}
                        />
                        <span>{syncingAll ? 'Đang đẩy xuống...' : 'Đẩy xuống máy'}</span>
                      </button>

                      <button
                        type="button"
                        className="hik-btn hik-btn-primary"
                        disabled={biSyncingAll || syncingAll || pullingAll}
                        onClick={() => handleQuickBidirectionalCluster(null)}
                        title="Đồng bộ trọn vẹn cả 2 chiều giữa phần mềm và toàn bộ máy chấm công của phân hiệu"
                      >
                        <Icon name="refresh" size={15} className={biSyncingAll ? 'hik-spin' : ''} />
                        <span>{biSyncingAll ? 'Đang đồng bộ 2 chiều...' : 'Đồng bộ 2 chiều'}</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Thanh định danh Phân hiệu đang thao tác */}
            <div className="hik-campus-bar">
              <div className="hik-campus-tabs">
                <span className="hik-campus-label">Phạm vi đồng bộ an toàn:</span>
                {campuses.length > 1 && isVendorSupport ? (
                  <>
                    <button
                      type="button"
                      className={`hik-campus-chip ${selectedCampus === 'ALL' ? 'active' : ''}`}
                      onClick={() => {
                        setSelectedCampus('ALL');
                        setRosterPage(1);
                      }}
                    >
                      Tất cả cơ sở ({campuses.length})
                    </button>
                    {campuses.map((cName) => (
                      <button
                        key={cName}
                        type="button"
                        className={`hik-campus-chip ${selectedCampus === cName ? 'active' : ''}`}
                        onClick={() => {
                          setSelectedCampus(cName);
                          setRosterPage(1);
                        }}
                      >
                        {cName}
                      </button>
                    ))}
                  </>
                ) : (
                  <span
                    className="hik-campus-chip active"
                    style={{ cursor: 'default', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  >
                    <Icon name="building" size={13} />
                    <span>{storedTenant?.name || campuses[0] || 'Phân hiệu hiện tại'}</span>
                  </span>
                )}
              </div>
              <span style={{ fontSize: 12, color: '#475569', fontWeight: 700 }}>
                Mã phân hiệu khóa phần cứng: <strong style={{ color: '#0f172a' }}>{resolvedSchoolCode || '—'}</strong>
                {isVendorSupport ? ' • Phiên Kỹ thuật Nhà cung cấp' : ''}
              </span>
            </div>

            {/* HIỆU ỨNG ĐANG QUÉT RADAR TRỰC TIẾP TRONG MẠNG LAN */}
            {scanningLan && (
              <div className="hik-radar-scanning-box hik-fade-in" role="status" aria-live="polite">
                <div className="hik-radar-orb">
                  <Icon name="radar" size={22} />
                </div>
                <div className="hik-scan-progress-wrap">
                  <div className="hik-scan-progress-head">
                    <strong>Đang dò tìm máy chấm công trong mạng nội bộ của trường...</strong>
                    <span className="hik-scan-progress-pct">{scanProgress}%</span>
                  </div>
                  <div className="hik-scan-progress-track">
                    <div
                      className="hik-scan-progress-fill"
                      style={{ width: `${Math.max(8, scanProgress)}%` }}
                    />
                  </div>
                  <p className="hik-scan-progress-sub">
                    {scanStatusText ||
                      'Đang kiểm tra các thiết bị Hikvision đang bật trong mạng LAN — bạn chưa cần nhập mật khẩu ở bước này.'}
                  </p>
                </div>
              </div>
            )}

            {/* KẾT QUẢ QUÉT MẠNG LAN (BƯỚC 1: HIỂN THỊ DANH SÁCH MÁY RÕ RÀNG — BẤM KẾT NỐI MỚI NHẬP MẬT KHẨU) */}
            {!scanningLan && lanScanResult && (
              <div className="hik-lan-panel hik-fade-in">
                <div className="hik-lan-header">
                  <div>
                    <h4>
                      <Icon name="radar" size={17} />
                      <span>
                        {lanScanResult.needsLocalConnector
                          ? 'Cần bật "Bộ kết nối 1 chạm" trên máy tính này để quét mạng nội bộ của trường'
                          : `Thiết bị tìm thấy trong mạng trường (${lanScanResult.scannedSubnets?.join(', ') || 'Mạng nội bộ'}) — ${
                              lanScanResult.discoveredDevices?.length || 0
                            } máy`}
                      </span>
                    </h4>
                    <p>
                      {lanScanResult.needsLocalConnector
                        ? 'Vì trang Web đang mở qua tên miền Internet, bạn hãy bật Bộ kết nối 1 chạm trên máy tính đặt tại trường để nhìn thấy máy chấm công trong mạng của phân hiệu.'
                        : 'Chọn máy chấm công tìm thấy bên dưới và bấm "Kết nối & Gắn vào phân hiệu" để nhập mật khẩu xác nhận.'}
                    </p>
                  </div>
                  <div className="hik-lan-controls">
                    <input
                      type="text"
                      name="hn_campus_lan_ip_filter"
                      autoComplete="off"
                      spellCheck={false}
                      value={subnetPrefix}
                      onChange={(e) => setSubnetPrefix(e.target.value)}
                      placeholder="Tùy chọn dải mạng / IP (VD: 192.168.1)"
                    />
                    <button
                      type="button"
                      className="hik-btn hik-btn-secondary hik-btn-sm"
                      disabled={scanningLan}
                      onClick={handleScanLan}
                    >
                      <Icon name="refresh" size={13} />
                      <span>Quét lại</span>
                    </button>
                    <button
                      type="button"
                      className="hik-icon-close"
                      onClick={() => setLanScanResult(null)}
                      aria-label="Đóng kết quả quét mạng"
                    >
                      <Icon name="close" size={16} />
                    </button>
                  </div>
                </div>

                {!lanScanResult.needsLocalConnector && connectorHealth.needsUpdate && (
                  <div
                    style={{
                      background: '#fffbeb',
                      border: '1px solid #fcd34d',
                      borderRadius: 11,
                      padding: '10px 14px',
                      fontSize: 12.5,
                      color: '#78350f',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      flexWrap: 'wrap'
                    }}
                  >
                    <span>
                      <strong>Lưu ý:</strong> Máy tính này đang chạy Bộ kết nối phiên bản cũ (<code>v{connectorHealth.version || '2.0.0'}</code>) nên có thể chưa hiện đủ tất cả máy chấm công trong mạng. Bạn hãy bấm cập nhật lên <code>v2.2.0</code> rồi bấm <strong>Quét lại</strong> nhé!
                    </span>
                    <button
                      type="button"
                      className="hik-btn hik-btn-primary hik-btn-sm"
                      disabled={downloadingConnector}
                      onClick={handleDownloadConnectorZip}
                    >
                      <Icon name="download" size={13} />
                      <span>Cập Nhật Bộ Kết Nối (.zip)</span>
                    </button>
                  </div>
                )}

                {lanScanResult.needsLocalConnector ? (
                  <div
                    style={{
                      background: '#ffffff',
                      padding: '14px 18px',
                      borderRadius: 12,
                      fontSize: 13,
                      color: '#1e293b',
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      border: '1px solid #fde68a'
                    }}
                  >
                    <div style={{ flex: '1 1 380px', lineHeight: 1.55 }}>
                      <strong>Hướng dẫn kết nối 2 bước nhanh chóng (chỉ thực hiện 1 lần đầu):</strong>
                      <div style={{ marginTop: 4, color: '#475569' }}>
                        <strong>Bước 1:</strong> Bấm nút <strong>&ldquo;Tải Bộ Kết Nối 1 Chạm (.zip)&rdquo;</strong> bên phải rồi giải nén ra máy tính.<br />
                        <strong>Bước 2:</strong> Mở tệp <code>1-Bat-Ket-Noi-1-Cham.bat</code>, sau đó bấm <strong>&ldquo;Đã bật xong — Quét ngay&rdquo;</strong>.
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="hik-btn hik-btn-secondary hik-btn-sm"
                        disabled={downloadingConnector}
                        onClick={handleDownloadConnectorZip}
                      >
                        <Icon name="download" size={14} />
                        <span>{downloadingConnector ? 'Đang tải...' : 'Tải Bộ Kết Nối 1 Chạm (.zip)'}</span>
                      </button>
                      <button
                        type="button"
                        className="hik-btn hik-btn-primary hik-btn-sm"
                        disabled={scanningLan}
                        onClick={handleScanLan}
                      >
                        <Icon name="refresh" size={14} />
                        <span>Đã bật xong — Quét ngay</span>
                      </button>
                    </div>
                  </div>
                ) : lanScanResult.discoveredDevices?.length === 0 ? (
                  <div
                    style={{
                      background: '#ffffff',
                      padding: '14px 16px',
                      borderRadius: 12,
                      fontSize: 13,
                      color: '#475569',
                      lineHeight: 1.55,
                      border: '1px solid #e2e8f0'
                    }}
                  >
                    Chưa tìm thấy máy chấm công nào đang bật trong dải mạng này. Bạn hãy kiểm tra xem máy chấm công ở cổng đã cắm điện và dùng chung mạng Wi-Fi/dây mạng với máy tính này chưa, hoặc nhập địa chỉ của máy (ví dụ: <code>192.168.1.8</code>) vào ô bên trên rồi bấm <strong>Quét lại</strong>.
                  </div>
                ) : (
                  <div className="hik-lan-list">
                    {lanScanResult.discoveredDevices.map((item) => (
                      <div key={`${item.host}:${item.port}`} className="hik-lan-item">
                        <div className="hik-lan-item-main">
                          <span className="hik-lan-device-icon">
                            <Icon name="server" size={20} />
                          </span>
                          <div className="hik-lan-item-copy">
                            <div className="hik-lan-item-title">
                              <span>Máy chấm công Hikvision — {item.host}</span>
                              {!item.lockedToOtherCampus && !item.alreadySaved && (
                                <span className="hik-status-pill hik-status-online" style={{ fontSize: 11 }}>
                                  Đang bật trong mạng LAN
                                </span>
                              )}
                            </div>
                            <div className="hik-lan-item-meta">
                              Dòng máy: <strong>{item.model || 'DS-K1T320MX'}</strong> · Cổng kết nối: {item.port || 80}
                              {item.serialNumber ? ` · Mã phần cứng: ${item.serialNumber}` : ''}
                              {item.currentStoredUsers !== null && item.currentStoredUsers !== undefined
                                ? ` · Đang lưu ${item.currentStoredUsers}/${item.maxUserCapacity || 500} hồ sơ`
                                : ''}
                            </div>
                          </div>
                        </div>

                        <div className="hik-lan-item-actions">
                          {item.lockedToOtherCampus ? (
                            <span
                              className="hik-status-pill hik-status-offline"
                              title="Thiết bị này đã khóa cho phân hiệu khác để chống kéo/đẩy nhầm"
                            >
                              <Icon name="lock" size={12} /> Thuộc phân hiệu khác
                            </span>
                          ) : item.alreadySaved ? (
                            <span className="hik-status-pill hik-status-online">
                              <Icon name="check" size={12} /> Đã gắn với phân hiệu ({item.savedName || item.savedCampus})
                            </span>
                          ) : isAdmin ? (
                            <button
                              type="button"
                              className="hik-btn hik-btn-primary"
                              onClick={() => openConnectDiscoveredModal(item)}
                            >
                              <Icon name="link" size={15} />
                              <span>Kết nối &amp; Gắn vào phân hiệu</span>
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* ─── BIỂU MẪU THÊM / SỬA MÁY CHẤM CÔNG THỦ CÔNG ─── */}
          {showDeviceForm && isAdmin && (
            <form className="hik-device-form-card hik-fade-in" autoComplete="off" onSubmit={handleSaveDevice}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <div>
                  <h3 style={{ margin: '0 0 3px', fontSize: 15, fontWeight: 800, color: '#0f172a' }}>
                    {editingDeviceId
                      ? 'Cập Nhật Cấu Hình Máy Chấm Công Của Phân Hiệu'
                      : 'Thêm Máy Chấm Công Thủ Công Cho Phân Hiệu'}
                  </h3>
                  <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>
                    Mật khẩu quản trị máy chấm công được mã hóa và khóa bảo mật riêng cho phân hiệu {resolvedSchoolCode}.
                  </p>
                </div>
                <button
                  type="button"
                  className="hik-icon-close"
                  onClick={() => {
                    setShowDeviceForm(false);
                    setEditingDeviceId(null);
                  }}
                >
                  <Icon name="close" size={16} />
                </button>
              </div>

              {/* Chặn trình duyệt tự điền tài khoản Web */}
              <input type="text" name="fake_dev_user" autoComplete="username" tabIndex={-1} aria-hidden="true" style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }} />
              <input type="password" name="fake_dev_pass" autoComplete="current-password" tabIndex={-1} aria-hidden="true" style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }} />

              <div className="hik-form-grid-4">
                <div className="hik-field">
                  <label>Tên gọi máy chấm công *</label>
                  <input
                    required
                    value={deviceForm.name}
                    onChange={(e) => setDeviceForm({ ...deviceForm, name: e.target.value })}
                    placeholder="VD: Máy chấm công Cổng chính"
                  />
                </div>

                <div className="hik-field">
                  <label>Phân hiệu / Cơ sở lắp đặt *</label>
                  <select
                    value={deviceForm.campus}
                    onChange={(e) => setDeviceForm({ ...deviceForm, campus: e.target.value })}
                  >
                    {campuses.map((cName) => (
                      <option key={cName} value={cName}>
                        {cName}
                      </option>
                    ))}
                    <option value="ALL">Dùng chung tất cả phân hiệu</option>
                  </select>
                </div>

                <div className="hik-field">
                  <label>Vị trí cửa lắp đặt</label>
                  <input
                    value={deviceForm.location}
                    onChange={(e) => setDeviceForm({ ...deviceForm, location: e.target.value })}
                    placeholder="VD: Sảnh đón trẻ Tầng 1"
                  />
                </div>

                <div className="hik-field">
                  <label>Mã định danh máy *</label>
                  <input
                    required
                    disabled={Boolean(editingDeviceId)}
                    value={deviceForm.deviceCode}
                    onChange={(e) => setDeviceForm({ ...deviceForm, deviceCode: e.target.value.toUpperCase() })}
                    placeholder="VD: HIK-CS1-01"
                  />
                </div>
              </div>

              <div className="hik-form-grid-4">
                <div className="hik-field">
                  <label>Địa chỉ IP mạng nội bộ *</label>
                  <input
                    required
                    value={deviceForm.host}
                    onChange={(e) => {
                      const nextHost = e.target.value;
                      setDeviceForm((prev) => ({
                        ...prev,
                        host: nextHost,
                        ...(!editingDeviceId
                          ? {
                              deviceCode: buildAutoDeviceCode(nextHost),
                              name: `Máy chấm công Hikvision (${nextHost.trim() || 'LAN'})`
                            }
                          : {})
                      }));
                    }}
                    placeholder="VD: 192.168.1.8"
                  />
                </div>

                <div className="hik-field">
                  <label>Giao thức &amp; Cổng kết nối</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select
                      style={{ width: '48%' }}
                      value={deviceForm.transportScheme}
                      onChange={(e) => {
                        const scheme = e.target.value;
                        setDeviceForm((prev) => ({
                          ...prev,
                          transportScheme: scheme,
                          port: scheme === 'https' && prev.port === 80 ? 443 : scheme === 'http' && prev.port === 443 ? 80 : prev.port
                        }));
                      }}
                    >
                      <option value="http">HTTP</option>
                      <option value="https">HTTPS</option>
                    </select>
                    <input
                      style={{ width: '52%' }}
                      type="number"
                      required
                      value={deviceForm.port}
                      onChange={(e) => setDeviceForm({ ...deviceForm, port: Number(e.target.value) })}
                    />
                  </div>
                </div>

                <div className="hik-field">
                  <label>Tài khoản quản trị máy</label>
                  <input
                    required
                    name="hn_device_admin_account"
                    autoComplete="off"
                    value={deviceForm.deviceUsername}
                    onChange={(e) => setDeviceForm({ ...deviceForm, deviceUsername: e.target.value })}
                    placeholder="admin"
                  />
                </div>

                <div className="hik-field">
                  <label>
                    Mật khẩu máy chấm công {editingDeviceId ? '(Để trống nếu giữ nguyên)' : ''}
                  </label>
                  <input
                    type="password"
                    name="hn_device_admin_secret"
                    autoComplete="new-password"
                    value={deviceForm.devicePassword}
                    onChange={(e) => setDeviceForm({ ...deviceForm, devicePassword: e.target.value })}
                    placeholder={editingDeviceId ? 'Giữ nguyên mật khẩu đã lưu' : 'Nhập mật khẩu của máy chấm công'}
                  />
                </div>
              </div>

              <div className="hik-form-grid-3">
                <div className="hik-field">
                  <label>Chiến lược phân bổ bộ nhớ 500 vị trí</label>
                  <select
                    value={deviceForm.syncAllocationMode}
                    onChange={(e) => setDeviceForm({ ...deviceForm, syncAllocationMode: e.target.value })}
                  >
                    {Object.entries(ALLOCATION_MODES).map(([key, meta]) => (
                      <option key={key} value={key}>
                        {meta.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="hik-field">
                  <label>Đối tượng đồng bộ xuống máy này</label>
                  <select
                    value={deviceForm.syncTargetScope}
                    onChange={(e) => setDeviceForm({ ...deviceForm, syncTargetScope: e.target.value })}
                  >
                    {Object.entries(TARGET_SCOPES).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="hik-field">
                  <label>Giới hạn bộ nhớ máy (Số vị trí tối đa)</label>
                  <input
                    type="number"
                    min="10"
                    max="50000"
                    value={deviceForm.maxUserCapacity}
                    onChange={(e) => setDeviceForm({ ...deviceForm, maxUserCapacity: Number(e.target.value) })}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', paddingTop: 4 }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 700, color: '#1d4ed8', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={deviceForm.autoSyncOnChange}
                    onChange={(e) => setDeviceForm({ ...deviceForm, autoSyncOnChange: e.target.checked })}
                  />
                  <span>Tự động ưu tiên đồng bộ hồ sơ thuộc phân hiệu {deviceForm.campus === 'ALL' ? 'toàn trường' : deviceForm.campus}</span>
                </label>

                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="hik-btn hik-btn-secondary"
                    onClick={() => {
                      setShowDeviceForm(false);
                      setEditingDeviceId(null);
                    }}
                  >
                    Hủy
                  </button>
                  <button type="submit" className="hik-btn hik-btn-primary" disabled={savingDevice}>
                    <Icon name={savingDevice ? 'refresh' : 'check'} size={15} className={savingDevice ? 'hik-spin' : ''} />
                    <span>{savingDevice ? 'Đang lưu & kiểm tra...' : 'Lưu Máy & Kiểm Tra Dung Lượng'}</span>
                  </button>
                </div>
              </div>
            </form>
          )}

          {/* ─── BÁO CÁO KẾT QUẢ KÉO NHANH / ĐỒNG BỘ 2 CHIỀU & GHÉP NHANH HỒ SƠ ─── */}
          {lastPullReport && (
            <section className="hik-pull-banner hik-fade-in">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <h4 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 800, color: '#064e3b', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Icon name="check" size={16} />
                    <span>
                      Kết quả đồng bộ tại &ldquo;{lastPullReport.deviceName}&rdquo; ({lastPullReport.campus} • {lastPullReport.host})
                    </span>
                  </h4>
                  <p style={{ margin: 0, fontSize: 12.5, color: '#065f46' }}>
                    Khớp tự động <strong>{lastPullReport.matchedCount || 0} hồ sơ</strong> của trường • Tải về{' '}
                    <strong>{lastPullReport.pulledFaceCount || 0} ảnh khuôn mặt (&lt;200KB)</strong>
                    {lastPullReport.eventsIngested !== undefined
                      ? ` • Ghi nhận ${lastPullReport.eventsIngested} lượt chấm công / điểm danh mới.`
                      : '.'}
                  </p>
                </div>
                <button
                  type="button"
                  className="hik-icon-close"
                  onClick={() => setLastPullReport(null)}
                >
                  <Icon name="close" size={16} />
                </button>
              </div>

              {Array.isArray(lastPullReport.syncedPeople) && lastPullReport.syncedPeople.length > 0 && (
                <div className="hik-pull-chips">
                  {lastPullReport.syncedPeople.map((p) => (
                    <div key={`${p.subjectType}:${p.subjectId}`} className="hik-pull-chip">
                      {p.faceDataUrl && <img src={p.faceDataUrl} alt={p.fullName} />}
                      <span>
                        [{p.personCode}] {p.fullName}
                      </span>
                      <span style={{ color: '#059669', fontSize: 10.5 }}>{p.sizeKB}KB</span>
                    </div>
                  ))}
                </div>
              )}

              {Array.isArray(lastPullReport.unmatchedOnDevice) &&
                lastPullReport.unmatchedOnDevice.length > 0 && (
                  <div className="hik-unmatched-box">
                    <div style={{ fontSize: 12.5, fontWeight: 800, color: '#92400e' }}>
                      Phát hiện {lastPullReport.unmatchedOnDevice.length} hồ sơ đăng ký trực tiếp trên máy chưa khớp Mã trên phần mềm — Ghép nhanh để lưu luôn Ảnh khuôn mặt &amp; Điểm danh:
                    </div>

                    {lastPullReport.unmatchedOnDevice.map((u) => {
                      const rowKey = `${u.deviceId}:${u.employeeNo}`;
                      return (
                        <div key={rowKey} className="hik-unmatched-row">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            {u.faceDataUrl ? (
                              <img
                                src={u.faceDataUrl}
                                alt={u.name}
                                style={{ width: 34, height: 34, borderRadius: 8, objectFit: 'cover', border: '1px solid #fbbf24' }}
                              />
                            ) : (
                              <span className="hik-avatar-circle">{String(u.name || 'M').charAt(0).toUpperCase()}</span>
                            )}
                            <div>
                              <div style={{ fontWeight: 800, fontSize: 12.5, color: '#0f172a' }}>
                                Mã trên máy: <code>{u.employeeNo}</code> — {u.name}
                              </div>
                              <div style={{ fontSize: 11, color: '#64748b' }}>
                                Máy: {u.deviceName} • {u.hasFace ? 'Có ảnh khuôn mặt sẵn trên máy' : 'Chưa có ảnh mặt'}
                              </div>
                            </div>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <select
                              className="hik-unmatched-select"
                              value={unmatchedLinkChoice[rowKey] || ''}
                              onChange={(e) =>
                                setUnmatchedLinkChoice((prev) => ({
                                  ...prev,
                                  [rowKey]: e.target.value
                                }))
                              }
                            >
                              <option value="">-- Chọn Nhân sự / Học sinh trên Web --</option>
                              {quickLinkCandidates.map((cand) => (
                                <option
                                  key={`${cand.subjectType}::${cand.subjectId}`}
                                  value={`${cand.subjectType}::${cand.subjectId}`}
                                >
                                  [{cand.subjectType === 'STUDENT' ? 'HS' : 'NS'}] {cand.personCode} — {cand.fullName} ({cand.campus})
                                </option>
                              ))}
                            </select>

                            <button
                              type="button"
                              className="hik-btn hik-btn-primary hik-btn-sm"
                              disabled={linkingExtKey === rowKey}
                              onClick={() => handleQuickLinkUnmatchedUser(u)}
                            >
                              {linkingExtKey === rowKey ? 'Đang ghép...' : 'Ghép & Lưu Ảnh Mặt Ngay'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
            </section>
          )}

          {/* ─── DANH SÁCH THẺ MÁY CHẤM CÔNG HOẶC HƯỚNG DẪN BẮT ĐẦU (KHÔNG LẶP LẠI KHI ĐANG QUÉT / MỞ FORM) ─── */}
          {loading ? (
            <div className="hik-hero-card" style={{ alignItems: 'center', padding: '36px 20px' }}>
              <span className="loading-orb" />
              <span style={{ fontSize: 13, fontWeight: 700, color: '#64748b' }}>
                Đang tải danh sách máy chấm công &amp; hồ sơ khuôn mặt...
              </span>
            </div>
          ) : devices.length === 0 ? (
            !scanningLan &&
            !lanScanResult &&
            !showDeviceForm && (
              <div className="hik-hero-card hik-fade-in" style={{ alignItems: 'center', textAlign: 'center', padding: '40px 24px' }}>
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 16,
                    background: '#eff6ff',
                    color: '#2563eb',
                    display: 'grid',
                    placeItems: 'center'
                  }}
                >
                  <Icon name="radar" size={26} />
                </div>
                <div>
                  <h3 style={{ margin: '6px 0', fontSize: 16.5, fontWeight: 800, color: '#0f172a' }}>
                    Chưa có máy chấm công nào được gắn vào {selectedCampus === 'ALL' ? 'phân hiệu này' : selectedCampus}
                  </h3>
                  <p style={{ margin: '0 auto', maxWidth: 540, fontSize: 13, color: '#64748b', lineHeight: 1.55 }}>
                    Bạn hãy bấm <strong>&ldquo;Quét tìm máy trong mạng&rdquo;</strong> để phần mềm tự động dò tìm thiết bị Hikvision đang bật tại trường (chưa cần nhập mật khẩu ngay), hoặc khai báo địa chỉ IP thủ công.
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', marginTop: 4 }}>
                  {canManageSync && (
                    <button type="button" className="hik-btn hik-btn-primary" onClick={handleScanLan} disabled={scanningLan}>
                      <Icon name="radar" size={15} />
                      <span>Quét tìm máy trong mạng</span>
                    </button>
                  )}
                  {isAdmin && (
                    <button type="button" className="hik-btn hik-btn-secondary" onClick={openAddDeviceForm}>
                      <Icon name="plus" size={15} />
                      <span>Thêm máy thủ công</span>
                    </button>
                  )}
                </div>
              </div>
            )
          ) : (
            <>
              <div className="hik-devices-grid hik-fade-in">
                {devices.map((dev) => {
                  const st = getDeviceStatusMeta(dev.status);
                  const scheme = (dev.transportScheme || 'http').toUpperCase();
                  const displayPort = scheme === 'HTTP' ? (dev.httpPort || 80) : (dev.httpsPort || 443);
                  const maxCap = Number(dev.maxUserCapacity) || 500;
                  const usedSlots = Number(dev.currentStoredUsers || dev.lastSyncSummary?.syncedUsers || 0);
                  const usagePercent = Math.min(100, Math.round((usedSlots / maxCap) * 100));
                  const allocMeta = ALLOCATION_MODES[dev.syncAllocationMode] || ALLOCATION_MODES.BY_CAMPUS_PRIORITY;
                  const busyState = deviceActionBusy[dev._id];

                  return (
                    <article key={dev._id} className="hik-device-card">
                      {busyState && <div className="hik-card-busy-bar" aria-hidden="true" />}

                      <div>
                        <div className="hik-device-card-top">
                          <div style={{ minWidth: 0 }}>
                            <div className="hik-device-badges">
                              <span className={`hik-status-pill ${st.cls}`}>
                                <span className="dot" />
                                {st.label}
                              </span>
                              <span className="hik-endpoint-pill">
                                {dev.host}:{displayPort}
                              </span>
                              {dev.serialNumber ? (
                                <span
                                  className="hik-serial-lock-pill"
                                  title="Đã khóa cứng mã phần cứng với phân hiệu này để không bao giờ kéo/đẩy nhầm sang trường khác"
                                >
                                  <Icon name="lock" size={11} /> Đã khóa phân hiệu ({dev.serialNumber.slice(-10)})
                                </span>
                              ) : (
                                <span className="hik-serial-lock-pill pending">
                                  <Icon name="unlock" size={11} /> Tự khóa mã máy ở lần đồng bộ đầu
                                </span>
                              )}
                            </div>
                            <h3 className="hik-device-title">{dev.name}</h3>
                            <p className="hik-device-meta">
                              Vị trí: <strong>{dev.location || 'Sảnh đón trẻ'}</strong> • Dòng máy:{' '}
                              <strong>{dev.model || 'Hikvision Khuôn mặt'}</strong>
                              {dev.webhookConfiguredUrl === fullWebhookUrl ? (
                                <span style={{ color: '#059669', fontWeight: 700 }}> • Đã trỏ đúng tên miền hiện tại</span>
                              ) : null}
                            </p>
                          </div>

                          <div className="hik-device-icon-actions">
                            <button
                              type="button"
                              className="hik-icon-btn"
                              title="Ánh xạ mã trên máy với Nhân sự / Học sinh"
                              onClick={() => openMappingsModal(dev)}
                            >
                              <Icon name="users" size={16} />
                            </button>
                            <button
                              type="button"
                              className="hik-icon-btn"
                              title="Xem nhật ký đồng bộ của máy"
                              onClick={() => openDeviceLogsModal(dev)}
                            >
                              <Icon name="fileText" size={16} />
                            </button>
                            {isAdmin && (
                              <>
                                <button
                                  type="button"
                                  className="hik-icon-btn"
                                  title="Chỉnh sửa cấu hình máy chấm công"
                                  onClick={() => openEditDeviceForm(dev)}
                                >
                                  <Icon name="edit" size={16} />
                                </button>
                                <button
                                  type="button"
                                  className="hik-icon-btn danger"
                                  title="Xóa máy chấm công"
                                  onClick={() => confirmDeleteDevice(dev)}
                                >
                                  <Icon name="trash" size={16} />
                                </button>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Thanh dung lượng bộ nhớ 500 vị trí */}
                        <div className="hik-capacity-box" style={{ marginTop: 12 }}>
                          <div className="hik-capacity-row">
                            <span className="hik-capacity-label">
                              <Icon name="hardDrive" size={15} />
                              Dung lượng bộ nhớ máy chấm công:
                            </span>
                            <span className={`hik-capacity-count ${usagePercent >= 90 ? 'danger' : ''}`}>
                              {usedSlots} / {maxCap} hồ sơ ({usagePercent}%)
                            </span>
                          </div>

                          <div className="hik-progress-track">
                            <div
                              className={`hik-progress-fill ${
                                usagePercent >= 90 ? 'danger' : usagePercent >= 70 ? 'warn' : ''
                              }`}
                              style={{ width: `${Math.max(4, usagePercent)}%` }}
                            />
                          </div>

                          <div className="hik-capacity-foot">
                            <span>
                              Cơ chế: <strong style={{ color: '#334155' }}>{allocMeta.shortLabel}</strong>
                            </span>
                            {dev.lastSyncSummary?.message ? (
                              <span className="hik-capacity-summary">{dev.lastSyncSummary.message}</span>
                            ) : (
                              <span>Đối tượng: {TARGET_SCOPES[dev.syncTargetScope] || TARGET_SCOPES.ALL}</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* TẦNG 1: 3 NÚT ĐỒNG BỘ CHÍNH (RÕ RÀNG, DỄ BẤM NHẤT CHO NGƯỜI QUẢN LÝ) */}
                      {canManageSync && (
                        <div className="hik-device-primary-actions">
                          <button
                            type="button"
                            className="hik-btn hik-btn-primary hik-btn-sm"
                            disabled={Boolean(busyState)}
                            onClick={() => handleQuickBidirectionalCluster(dev)}
                            title="1 chạm đồng bộ cả 2 phía (Kéo từ máy về Web + Đẩy từ Web xuống máy)"
                          >
                            <Icon
                              name="refresh"
                              size={14}
                              className={busyState === 'bisync' ? 'hik-spin' : ''}
                            />
                            <span>{busyState === 'bisync' ? 'Đang chạy 2 chiều...' : 'Đồng bộ 2 chiều'}</span>
                          </button>

                          <button
                            type="button"
                            className="hik-btn hik-btn-secondary hik-btn-sm"
                            disabled={Boolean(busyState)}
                            onClick={() => askPullUsersFromDevice(dev)}
                            title="Kéo ảnh khuôn mặt, hồ sơ & lượt chấm công từ máy này về Web"
                          >
                            <Icon
                              name={busyState === 'pull' ? 'refresh' : 'download'}
                              size={14}
                              className={busyState === 'pull' ? 'hik-spin' : ''}
                            />
                            <span>{busyState === 'pull' ? 'Đang kéo về...' : 'Kéo về Web'}</span>
                          </button>

                          <button
                            type="button"
                            className="hik-btn hik-btn-secondary hik-btn-sm"
                            disabled={Boolean(busyState)}
                            onClick={() => askPushSync(dev)}
                            title="Đẩy nhanh hồ sơ & ảnh khuôn mặt từ Web xuống máy này"
                          >
                            <Icon
                              name={busyState === 'push' ? 'refresh' : 'upload'}
                              size={14}
                              className={busyState === 'push' ? 'hik-spin' : ''}
                            />
                            <span>{busyState === 'push' ? 'Đang đẩy xuống...' : 'Đẩy xuống máy'}</span>
                          </button>
                        </div>
                      )}

                      {/* TẦNG 2: THANH TIỆN ÍCH PHẦN CỨNG GỌN GÀNG */}
                      <div className="hik-device-utility-bar">
                        <button
                          type="button"
                          className="hik-utility-chip"
                          disabled={Boolean(busyState)}
                          onClick={() => handleCheckCapacity(dev)}
                        >
                          <Icon
                            name={busyState === 'capacity' ? 'refresh' : 'wifi'}
                            size={13}
                            className={busyState === 'capacity' ? 'hik-spin' : ''}
                          />
                          <span>{busyState === 'capacity' ? 'Đang kiểm tra...' : 'Kiểm tra bộ nhớ'}</span>
                        </button>

                        {canControlHardware && (
                          <button
                            type="button"
                            className="hik-utility-chip"
                            disabled={Boolean(busyState)}
                            onClick={() => handlePullEventLogsFromMachine(dev)}
                            title="Chỉ đọc riêng lịch sử quẹt mặt/thẻ lưu trên máy chấm công"
                          >
                            <Icon
                              name={busyState === 'events' ? 'refresh' : 'clock'}
                              size={13}
                              className={busyState === 'events' ? 'hik-spin' : ''}
                            />
                            <span>{busyState === 'events' ? 'Đang đọc lượt quẹt...' : 'Đọc lượt điểm danh'}</span>
                          </button>
                        )}

                        {canControlHardware && (
                          <button
                            type="button"
                            className="hik-utility-chip"
                            disabled={Boolean(busyState)}
                            onClick={() => askUnlockDoor(dev)}
                          >
                            <Icon name="unlock" size={13} />
                            <span>{busyState === 'door' ? 'Đang mở cửa...' : 'Mở cửa từ xa'}</span>
                          </button>
                        )}

                        {canControlHardware && (
                          <button
                            type="button"
                            className="hik-utility-chip"
                            disabled={Boolean(busyState)}
                            onClick={() => askPruneDevice(dev)}
                          >
                            <Icon name="eraser" size={13} />
                            <span>{busyState === 'prune' ? 'Đang dọn...' : 'Dọn hồ sơ nghỉ'}</span>
                          </button>
                        )}

                        {canControlHardware && (
                          <button
                            type="button"
                            className="hik-utility-chip"
                            disabled={Boolean(busyState)}
                            onClick={() => handleUpdateWebhookDomain(dev)}
                            title="Cập nhật địa chỉ tên miền Web hiện tại xuống máy chấm công để nhận điểm danh tức thì"
                          >
                            <Icon
                              name={busyState === 'webhook' ? 'refresh' : 'globe'}
                              size={13}
                              className={busyState === 'webhook' ? 'hik-spin' : ''}
                            />
                            <span>
                              {busyState === 'webhook' ? 'Đang cập nhật...' : 'Cập nhật tên miền Web'}
                            </span>
                          </button>
                        )}

                        {isVendorSupport && isAdmin && (
                          <button
                            type="button"
                            className="hik-utility-chip"
                            style={{ borderColor: '#fcd34d', background: '#fffbeb', color: '#92400e' }}
                            onClick={() => {
                              setVendorSerialModalDev(dev);
                              setVendorSerialForm({
                                newSerialNumber: dev.serialNumber || '',
                                targetSchoolCode: ''
                              });
                            }}
                            title="Chỉ dành cho Kỹ thuật viên Nhà cung cấp: Gỡ khóa mã phần cứng hoặc chuyển máy sang phân hiệu khác"
                          >
                            <Icon name="wrench" size={13} />
                            <span>Gỡ khóa / Chuyển Phân hiệu</span>
                          </button>
                        )}

                        {dev.unmappedCount > 0 && (
                          <button
                            type="button"
                            className="hik-utility-chip"
                            style={{ borderColor: '#fbbf24', background: '#fef3c7', color: '#92400e' }}
                            onClick={() => openUnmappedModal(dev)}
                          >
                            <span>{dev.unmappedCount} lượt chưa ghép</span>
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  flexWrap: 'wrap',
                  padding: '12px 18px',
                  borderRadius: 14,
                  background: '#ffffff',
                  border: '1px solid #e2e8f0'
                }}
              >
                <span style={{ fontSize: 13, color: '#475569' }}>
                  Muốn chụp Camera hoặc cập nhật ảnh chân dung khuôn mặt cho học sinh &amp; giáo viên trước khi đẩy xuống máy?
                </span>
                <button
                  type="button"
                  className="hik-btn hik-btn-secondary hik-btn-sm"
                  onClick={() => setActiveWorkspaceTab('roster')}
                >
                  <Icon name="camera" size={14} />
                  <span>Mở danh sách Ảnh khuôn mặt ({pagination.totalItems} hồ sơ)</span>
                </button>
              </div>
            </>
          )}
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════════════
          PHÂN KHU 2: DANH SÁCH ẢNH KHUÔN MẶT HỌC SINH & NHÂN SỰ (<200KB)
         ═══════════════════════════════════════════════════════════════════════════════ */}
      {activeWorkspaceTab === 'roster' && (
        <section className="hik-roster-card hik-fade-in">
          <div className="hik-roster-header">
            <div>
              <h3>
                Danh Sách Nhân Sự, Học Sinh &amp; Ảnh Quét Mặt Chấm Công ({pagination.totalItems} hồ sơ)
              </h3>
              <p>
                <strong>Ảnh quét mặt chấm công</strong> dùng riêng để đẩy xuống máy Hikvision của phân hiệu (tách biệt với ảnh đại diện trên Web). Mọi ảnh chụp Camera hoặc tải lên đều được tự động căn chỉnh dung lượng gọn nhẹ <strong>&lt; 200KB</strong>.
              </p>
            </div>

            <form
              className="hik-roster-filters"
              onSubmit={(e) => {
                e.preventDefault();
                setAppliedSearch(searchInput.trim());
                setRosterPage(1);
              }}
            >
              <select
                value={subjectFilter}
                onChange={(e) => {
                  setSubjectFilter(e.target.value);
                  setRosterPage(1);
                }}
              >
                <option value="ALL">Tất cả đối tượng</option>
                <option value="EMPLOYEE">Nhân sự / Giáo viên</option>
                <option value="STUDENT">Học sinh</option>
              </select>

              <select
                value={faceStatusFilter}
                onChange={(e) => {
                  setFaceStatusFilter(e.target.value);
                  setRosterPage(1);
                }}
              >
                <option value="ALL">Tất cả trạng thái ảnh</option>
                <option value="WITH_FACE">Đã có ảnh mặt (&lt;200KB)</option>
                <option value="MISSING_FACE">Chưa có ảnh quét mặt</option>
              </select>

              <input
                type="search"
                value={searchInput}
                onChange={(e) => {
                  setSearchInput(e.target.value);
                  if (!e.target.value.trim() && appliedSearch) {
                    setAppliedSearch('');
                    setRosterPage(1);
                  }
                }}
                placeholder="Tìm mã NV/HS, họ tên, lớp..."
              />

              <button type="submit" className="hik-btn hik-btn-secondary hik-btn-sm">
                <Icon name="search" size={14} /> Lọc
              </button>
            </form>
          </div>

          <div className="hik-roster-table-wrap">
            <table className="hik-roster-table">
              <thead>
                <tr>
                  <th>Mã chấm công</th>
                  <th>Họ tên &amp; Phân hiệu</th>
                  <th>Ảnh Quét Mặt Chấm Công</th>
                  <th style={{ textAlign: 'right' }}>Đẩy lẻ xuống máy</th>
                </tr>
              </thead>
              <tbody>
                {roster.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', padding: '28px 16px', color: '#64748b' }}>
                      Không có hồ sơ Nhân sự / Học sinh nào khớp với bộ lọc hiện tại.
                    </td>
                  </tr>
                ) : (
                  roster.map((item) => {
                    const rowKey = `${item.subjectType}:${item.subjectId}`;
                    const busyMode = personActionBusy[rowKey];
                    const initialChar = (item.fullName || item.personCode || 'H').charAt(0).toUpperCase();

                    return (
                      <tr key={rowKey}>
                        <td className="hik-code-cell">{item.personCode}</td>

                        <td>
                          <div className="hik-person-cell">
                            {item.webAvatar ? (
                              <img
                                src={item.webAvatar}
                                alt={item.fullName}
                                className="hik-avatar-circle"
                                title="Ảnh đại diện hiển thị trên Web"
                              />
                            ) : (
                              <span className="hik-avatar-circle">{initialChar}</span>
                            )}
                            <div>
                              <p className="hik-person-name">{item.fullName}</p>
                              <p className="hik-person-sub">
                                {item.subjectType === 'STUDENT' ? 'Học sinh' : 'Nhân sự'} •{' '}
                                <strong>{item.roleOrClassLabel}</strong> • {item.campus}
                              </p>
                            </div>
                          </div>
                        </td>

                        <td>
                          <div className="hik-face-cell">
                            {item.hasBiometricFace && item.faceDataUrl ? (
                              <span className="hik-face-ready-badge">
                                <img src={item.faceDataUrl} alt={`Face ${item.fullName}`} />
                                <span>Đã có ảnh mặt ({item.faceSizeKB}KB)</span>
                              </span>
                            ) : (
                              <span className="hik-face-empty-badge">Chưa có ảnh quét mặt</span>
                            )}

                            {canManageSync && (
                              <>
                                <button
                                  type="button"
                                  className="hik-btn hik-btn-primary hik-btn-sm"
                                  disabled={Boolean(busyMode)}
                                  onClick={() => setCameraTarget(item)}
                                >
                                  <Icon name="camera" size={13} />
                                  <span>Chụp Camera</span>
                                </button>

                                <label className="hik-btn hik-btn-secondary hik-btn-sm">
                                  <Icon name="upload" size={13} />
                                  <span>
                                    {busyMode === 'upload'
                                      ? 'Đang nén...'
                                      : item.hasBiometricFace
                                        ? 'Đổi ảnh'
                                        : 'Chọn ảnh'}
                                  </span>
                                  <input
                                    type="file"
                                    accept="image/jpeg,image/png,image/webp"
                                    hidden
                                    disabled={Boolean(busyMode)}
                                    onChange={(e) => handleFileUploadForPerson(item, e)}
                                  />
                                </label>
                              </>
                            )}
                          </div>
                        </td>

                        <td style={{ textAlign: 'right' }}>
                          <button
                            type="button"
                            className="hik-btn hik-btn-secondary hik-btn-sm"
                            disabled={Boolean(busyMode) || devices.length === 0 || !canManageSync}
                            onClick={() => handlePushSinglePerson(item)}
                            title={devices.length === 0 ? 'Cần kết nối ít nhất 1 máy chấm công trước khi đẩy ảnh' : 'Đẩy ngay hồ sơ này xuống máy chấm công'}
                          >
                            <Icon
                              name={busyMode === 'push' ? 'refresh' : 'send'}
                              size={13}
                              className={busyMode === 'push' ? 'hik-spin' : ''}
                            />
                            <span>{busyMode === 'push' ? 'Đang đẩy...' : 'Đẩy xuống máy'}</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {pagination.totalPages > 1 && (
            <div className="hik-pagination-bar">
              <span>
                Trang <strong>{pagination.page}</strong> / {pagination.totalPages} ({pagination.totalItems} hồ sơ)
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="hik-btn hik-btn-secondary hik-btn-sm"
                  disabled={pagination.page <= 1}
                  onClick={() => setRosterPage((p) => Math.max(1, p - 1))}
                >
                  Trang trước
                </button>
                <button
                  type="button"
                  className="hik-btn hik-btn-secondary hik-btn-sm"
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() => setRosterPage((p) => Math.min(pagination.totalPages, p + 1))}
                >
                  Trang tiếp
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════════════
          PHÂN KHU 3: ĐỊA CHỈ NHẬN ĐIỂM DANH TỰ ĐỘNG (ĐỘNG THEO TÊN MIỀN) & NHẬT KÝ TRỰC TIẾP
         ═══════════════════════════════════════════════════════════════════════════════ */}
      {activeWorkspaceTab === 'webhook' && (
        <>
          <section className="hik-webhook-strip hik-fade-in">
            <div style={{ flex: '1 1 420px', minWidth: 0 }}>
              <div style={{ fontSize: 11.5, fontWeight: 800, color: '#1d4ed8', textTransform: 'uppercase', marginBottom: 4 }}>
                Địa chỉ nhận điểm danh tự động theo tên miền hiện tại ({resolvedSchoolCode})
              </div>
              <p style={{ margin: '0 0 10px', fontSize: 12.5, color: '#475569', lineHeight: 1.5 }}>
                Khi học sinh hoặc giáo viên quét khuôn mặt tại cổng, máy chấm công sẽ tự động gửi kết quả về địa chỉ dưới đây. Nếu nhà trường đổi sang tên miền mới, chỉ cần bấm nút cập nhật 1 chạm để đẩy địa chỉ mới xuống tất cả máy.
              </p>
              <div className="hik-webhook-url-box">
                <Icon name="link" size={15} />
                <code>{fullWebhookUrl}</code>
                <button type="button" className="hik-btn hik-btn-secondary hik-btn-sm" onClick={handleCopyWebhookUrl}>
                  <Icon name="copy" size={13} /> {copiedUrl ? 'Đã sao chép' : 'Sao chép địa chỉ'}
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {canControlHardware && devices.length > 0 && (
                <button
                  type="button"
                  className="hik-btn hik-btn-primary hik-btn-sm"
                  disabled={updatingWebhookAll}
                  onClick={() => handleUpdateWebhookDomain(null)}
                >
                  <Icon
                    name={updatingWebhookAll ? 'refresh' : 'globe'}
                    size={14}
                    className={updatingWebhookAll ? 'hik-spin' : ''}
                  />
                  <span>
                    {updatingWebhookAll
                      ? 'Đang cập nhật xuống máy...'
                      : '1 Chạm Cập Nhật Tên Miền Mới Xuống Máy'}
                  </span>
                </button>
              )}
              {canControlHardware && (
                <button type="button" className="hik-btn hik-btn-secondary hik-btn-sm" onClick={openWebhookSimulator}>
                  <Icon name="send" size={14} /> Thử nghiệm quét mặt điểm danh
                </button>
              )}
              <button type="button" className="hik-btn hik-btn-secondary hik-btn-sm" onClick={openWebhookLogs}>
                <Icon name="fileText" size={14} /> Lịch sử nhận điểm danh
              </button>
            </div>
          </section>

          <section className="hik-live-feed-card hik-fade-in">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 14, color: '#0f172a', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Icon name="bell" size={16} />
                <span>Hoạt động điểm danh &amp; thiết bị theo thời gian thực tại phân hiệu ({resolvedSchoolCode})</span>
              </strong>
              <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>Tự động cập nhật trực tiếp</span>
            </div>

            {liveFeedEvents.length === 0 ? (
              <div style={{ padding: '20px 16px', borderRadius: 12, background: '#f8fafc', border: '1px solid #e2e8f0', color: '#64748b', fontSize: 13, textAlign: 'center' }}>
                Chưa có thông báo điểm danh mới trong phiên này. Khi trẻ hoặc nhân sự quét khuôn mặt qua cổng, thông báo tiếng Việt sẽ hiển thị ngay tại đây.
              </div>
            ) : (
              <div className="hik-live-feed-list">
                {liveFeedEvents.map((ev) => (
                  <div key={ev.id} className={`hik-live-event-item ${ev.tone || 'info'}`}>
                    <div style={{ minWidth: 0 }}>
                      <strong style={{ display: 'block', color: '#0f172a', marginBottom: 2 }}>{ev.title}</strong>
                      <span style={{ color: '#334155' }}>{ev.message}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {/* ─── MODAL CHỤP CAMERA & NÉN ẢNH KHUÔN MẶT (<200KB) ─── */}
      {cameraTarget && (
        <BiometricFaceCameraModal
          key={`${cameraTarget.subjectType}:${cameraTarget.subjectId}`}
          target={cameraTarget}
          onClose={() => setCameraTarget(null)}
          onConfirmSave={handleSaveFromCameraModal}
        />
      )}

      {/* ─── MODAL XÁC NHẬN AN TOÀN PHẦN CỨNG (PULL / PUSH / PRUNE / DOOR / DELETE) ─── */}
      {confirmState &&
        createPortal(
          <div className="hik-modal-backdrop" onClick={() => setConfirmState(null)} role="presentation">
            <div className="hik-confirm-modal" onClick={(e) => e.stopPropagation()}>
              <div className="hik-camera-header">
                <div>
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '3px 9px',
                      borderRadius: 999,
                      fontSize: 10.5,
                      fontWeight: 800,
                      marginBottom: 6,
                      background: confirmState.tone === 'danger' ? '#fff1f2' : '#eef2ff',
                      color: confirmState.tone === 'danger' ? '#be123c' : '#4338ca'
                    }}
                  >
                    {confirmState.badge}
                  </span>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#0f172a' }}>
                    {confirmState.title}
                  </h3>
                </div>
                <button type="button" className="hik-icon-close" onClick={() => setConfirmState(null)}>
                  <Icon name="close" size={16} />
                </button>
              </div>

              <div className="hik-camera-body">
                <p style={{ margin: 0, fontSize: 13, color: '#334155', lineHeight: 1.55 }}>
                  {confirmState.description}
                </p>

                {Array.isArray(confirmState.bullets) && confirmState.bullets.length > 0 && (
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: '#475569', lineHeight: 1.6 }}>
                    {confirmState.bullets.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                )}

                {confirmState.mode === 'PULL_USERS' && (
                  <div style={{ padding: 12, borderRadius: 12, background: '#f8fafc', border: '1px solid #e2e8f0', fontSize: 12.5 }}>
                    <div style={{ fontWeight: 800, color: '#0f172a', marginBottom: 8 }}>
                      Tùy chọn chế độ lưu Ảnh khuôn mặt khi kéo về Web:
                    </div>
                    <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8, cursor: 'pointer' }}>
                      <input
                        type="radio"
                        checked={overwriteFacesOnPull === true}
                        onChange={() => setOverwriteFacesOnPull(true)}
                      />
                      <span>
                        <strong>Cập nhật &amp; ghi đè toàn bộ ảnh mặt từ máy chấm công về Web</strong> (Khuyên dùng khi ảnh đã đăng ký trên máy là chuẩn nhất).
                      </span>
                    </label>
                    <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
                      <input
                        type="radio"
                        checked={overwriteFacesOnPull === false}
                        onChange={() => setOverwriteFacesOnPull(false)}
                      />
                      <span>
                        <strong>Chỉ tải bổ sung cho những hồ sơ chưa có ảnh mặt trên Web</strong> (Giữ nguyên những ảnh đã chụp trên Web).
                      </span>
                    </label>
                  </div>
                )}

                {confirmState.mode === 'PUSH_SYNC' && (
                  <label
                    style={{
                      display: 'flex',
                      gap: 8,
                      alignItems: 'flex-start',
                      padding: 12,
                      borderRadius: 12,
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      fontSize: 12.5,
                      cursor: 'pointer'
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={forceFullPush}
                      onChange={(e) => setForceFullPush(e.target.checked)}
                    />
                    <span>
                      <strong>Ép nạp lại toàn bộ 100% hồ sơ &amp; ảnh mặt</strong> (Mặc định không tích sẽ dùng chế độ <strong>Đồng bộ Nhanh Delta</strong> chỉ đẩy những hồ sơ mới/thay đổi để hoàn tất trong vài giây).
                    </span>
                  </label>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 6 }}>
                  <button
                    type="button"
                    className="hik-btn hik-btn-neutral"
                    onClick={() => setConfirmState(null)}
                  >
                    Hủy bỏ
                  </button>
                  <button
                    type="button"
                    className={`hik-btn ${confirmState.tone === 'danger' ? 'hik-btn-danger' : 'hik-btn-indigo'}`}
                    onClick={async () => {
                      const current = confirmState;
                      setConfirmState(null);
                      try {
                        if (current.mode === 'PULL_USERS' && current.deviceId) {
                          await executePullFromDevice(current.deviceId, overwriteFacesOnPull);
                        } else if (current.mode === 'PUSH_SYNC') {
                          await executePushSync(current.targetDevice, forceFullPush);
                        } else if (current.onExecute) {
                          await current.onExecute();
                        }
                      } catch (err) {
                        showToast(
                          toFriendlyVietnameseNotice(err, 'Chưa thực hiện được thao tác trên máy chấm công.'),
                          'error'
                        );
                      }
                    }}
                  >
                    {confirmState.confirmLabel || 'Xác nhận thực hiện'}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* ─── MODAL GIẢ LẬP WEBHOOK ─── */}
      {activeModal === 'simulate_webhook' &&
        createPortal(
          <div className="account-modal-backdrop" onClick={() => setActiveModal(null)} role="presentation">
            <form
              className="account-modal-card student-form"
              style={{ width: 'min(620px, 96vw)' }}
              onClick={(e) => e.stopPropagation()}
              onSubmit={handleRunWebhookSimulation}
            >
              <div className="account-modal-header">
                <div>
                  <p className="card-kicker">KIỂM TRA ĐỒNG BỘ QUA WEBHOOK</p>
                  <h2>Giả lập quẹt Khuôn mặt / Thẻ từ ({resolvedSchoolCode})</h2>
                </div>
                <button type="button" className="button button-secondary modal-close-btn" onClick={() => setActiveModal(null)}>
                  <Icon name="close" size={18} />
                </button>
              </div>

              <div className="student-form-grid">
                <label>
                  Đối tượng kiểm tra
                  <select
                    value={simForm.targetMode}
                    onChange={(e) => {
                      const mode = e.target.value;
                      if (mode === 'STUDENT' && students[0]) {
                        setSimForm({
                          ...simForm,
                          targetMode: mode,
                          externalPersonId: students[0].studentCode || '',
                          personName: students[0].fullName || ''
                        });
                      } else if (mode === 'EMPLOYEE' && employees[0]) {
                        setSimForm({
                          ...simForm,
                          targetMode: mode,
                          externalPersonId: employees[0].employeeCode || '',
                          personName: employees[0].fullName || ''
                        });
                      } else {
                        setSimForm({ ...simForm, targetMode: mode });
                      }
                    }}
                  >
                    <option value="STUDENT">Điểm danh Học sinh</option>
                    <option value="EMPLOYEE">Chấm công Nhân sự / Giáo viên</option>
                    <option value="CUSTOM">Nhập mã bất kỳ</option>
                  </select>
                </label>

                <label>
                  Phương thức xác thực
                  <select
                    value={simForm.verifyMode}
                    onChange={(e) => setSimForm({ ...simForm, verifyMode: e.target.value })}
                  >
                    <option value="FACE">Khuôn mặt (FACE)</option>
                    <option value="CARD">Thẻ từ (CARD)</option>
                    <option value="FINGERPRINT">Vân tay (FINGERPRINT)</option>
                  </select>
                </label>

                <label>
                  Mã gửi từ máy (employeeNo / studentCode) *
                  <input
                    required
                    value={simForm.externalPersonId}
                    onChange={(e) => setSimForm({ ...simForm, externalPersonId: e.target.value })}
                  />
                </label>

                <label>
                  Họ tên hiển thị
                  <input
                    value={simForm.personName}
                    onChange={(e) => setSimForm({ ...simForm, personName: e.target.value })}
                  />
                </label>
              </div>

              {simResult && (
                <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 12, background: '#ecfdf5', border: '1px solid #a7f3d0', fontSize: 13, color: '#065f46' }}>
                  <strong>✓ Đã xử lý tại {simResult.endpointPath}:</strong> {simResult.processingNote}
                </div>
              )}

              <div className="account-modal-actions">
                <button type="button" className="button button-secondary" onClick={() => setActiveModal(null)}>
                  Đóng
                </button>
                <button type="submit" className="button button-primary" disabled={simulating}>
                  <Icon name="send" size={15} /> {simulating ? 'Đang gửi...' : 'Gửi sự kiện Webhook ngay'}
                </button>
              </div>
            </form>
          </div>,
          document.body
        )}

      {/* ─── MODAL NHẬT KÝ WEBHOOK ─── */}
      {activeModal === 'webhook_logs' &&
        createPortal(
          <div className="account-modal-backdrop" onClick={() => setActiveModal(null)} role="presentation">
            <div className="account-modal-card" style={{ width: 'min(880px, 96vw)' }} onClick={(e) => e.stopPropagation()}>
              <div className="account-modal-header">
                <div>
                  <p className="card-kicker">NHẬT KÝ GÓI TIN WEBHOOK</p>
                  <h2>Lịch sử đồng bộ trường {resolvedSchoolCode}</h2>
                </div>
                <button type="button" className="button button-secondary modal-close-btn" onClick={() => setActiveModal(null)}>
                  <Icon name="close" size={18} />
                </button>
              </div>

              {webhookLogsLoading ? (
                <div className="inline-loader">Đang tải nhật ký Webhook...</div>
              ) : webhookLogs.length === 0 ? (
                <p style={{ textAlign: 'center', padding: 24, color: '#64748b' }}>Chưa có gói tin Webhook nào.</p>
              ) : (
                <div className="table-wrap">
                  <table className="data-table sa-clean-table">
                    <thead>
                      <tr>
                        <th>Thời gian</th>
                        <th>Thiết bị</th>
                        <th>Mã người quẹt</th>
                        <th>Trạng thái</th>
                        <th>Kết quả</th>
                      </tr>
                    </thead>
                    <tbody>
                      {webhookLogs.map((log) => (
                        <tr key={log._id}>
                          <td>{new Date(log.createdAt).toLocaleString('vi-VN')}</td>
                          <td><strong>{log.deviceCode || 'WEBHOOK'}</strong></td>
                          <td>{log.hikvisionSummary?.employeeNoString || '—'}</td>
                          <td>{log.processingStatus}</td>
                          <td>{log.processingNote || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>,
          document.body
        )}

      {/* ─── MODAL ÁNH XẠ ID MÁY THỦ CÔNG ─── */}
      {activeModal === 'mappings' &&
        selectedDevice &&
        createPortal(
          <div className="account-modal-backdrop" onClick={() => setActiveModal(null)} role="presentation">
            <div className="account-modal-card" style={{ width: 'min(820px, 96vw)' }} onClick={(e) => e.stopPropagation()}>
              <div className="account-modal-header">
                <div>
                  <p className="card-kicker">ÁNH XẠ MÃ NGƯỜI DÙNG TRÊN MÁY</p>
                  <h2>{selectedDevice.name} ({selectedDevice.campus})</h2>
                </div>
                <button type="button" className="button button-secondary modal-close-btn" onClick={() => setActiveModal(null)}>
                  <Icon name="close" size={18} />
                </button>
              </div>

              {isAdmin && (
                <form onSubmit={handleSaveMapping} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginBottom: 16 }}>
                  <input
                    required
                    placeholder="ID trên máy (VD: 101)"
                    value={newMapping.externalPersonId}
                    onChange={(e) => setNewMapping({ ...newMapping, externalPersonId: e.target.value })}
                  />
                  <select
                    value={newMapping.subjectType}
                    onChange={(e) => {
                      const type = e.target.value;
                      const nextId =
                        type === 'EMPLOYEE'
                          ? (employees[0]?.userId?._id || employees[0]?.userId || '')
                          : (students[0]?._id || '');
                      setNewMapping({ ...newMapping, subjectType: type, subjectId: nextId });
                    }}
                  >
                    <option value="EMPLOYEE">Nhân sự</option>
                    <option value="STUDENT">Học sinh</option>
                  </select>
                  <select
                    required
                    value={newMapping.subjectId}
                    onChange={(e) => setNewMapping({ ...newMapping, subjectId: e.target.value })}
                  >
                    <option value="">-- Chọn hồ sơ --</option>
                    {newMapping.subjectType === 'EMPLOYEE'
                      ? employees
                          .filter((emp) => emp.userId)
                          .map((emp) => {
                            const uid = emp.userId?._id || emp.userId;
                            return (
                              <option key={uid} value={uid}>
                                {emp.employeeCode} — {emp.fullName}
                              </option>
                            );
                          })
                      : students.map((s) => (
                          <option key={s._id} value={s._id}>
                            {s.studentCode} — {s.fullName}
                          </option>
                        ))}
                  </select>
                  <button type="submit" className="hik-btn hik-btn-indigo">
                    + Lưu ánh xạ
                  </button>
                </form>
              )}

              {mappingLoading ? (
                <div className="inline-loader">Đang tải danh sách ánh xạ...</div>
              ) : mappings.length === 0 ? (
                <p style={{ textAlign: 'center', padding: 20, color: '#64748b' }}>
                  Chưa có bản ghi ánh xạ. Khi bạn bấm &ldquo;Đẩy Nhanh&rdquo; hoặc &ldquo;Đồng bộ 2 chiều&rdquo;, hệ thống sẽ tự động tạo ánh xạ cho toàn bộ Nhân sự &amp; Học sinh!
                </p>
              ) : (
                <div className="table-wrap">
                  <table className="data-table sa-clean-table">
                    <thead>
                      <tr>
                        <th>ID trên máy</th>
                        <th>Loại</th>
                        <th>Họ tên trên hệ thống</th>
                        {isAdmin && <th>Xóa</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {mappings.map((m) => (
                        <tr key={m._id}>
                          <td><strong>{m.externalPersonId}</strong></td>
                          <td>{m.subjectType === 'STUDENT' ? 'Học sinh' : 'Nhân sự'}</td>
                          <td>{m.userId?.profile?.fullName || m.studentId?.fullName || m.metadata?.displayName || '—'}</td>
                          {isAdmin && (
                            <td>
                              <button type="button" className="hik-btn hik-btn-neutral hik-btn-sm" onClick={() => handleRemoveMapping(m._id)}>
                                Xóa
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>,
          document.body
        )}

      {/* ─── MODAL NHẬT KÝ ĐỒNG BỘ MÁY & SỰ KIỆN CHƯA MAP ─── */}
      {activeModal === 'logs' &&
        selectedDevice &&
        createPortal(
          <div className="account-modal-backdrop" onClick={() => setActiveModal(null)} role="presentation">
            <div className="account-modal-card" style={{ width: 'min(820px, 96vw)' }} onClick={(e) => e.stopPropagation()}>
              <div className="account-modal-header">
                <div>
                  <p className="card-kicker">NHẬT KÝ ĐỒNG BỘ SỰ KIỆN TỪ MÁY</p>
                  <h2>{selectedDevice.name}</h2>
                </div>
                <button type="button" className="button button-secondary modal-close-btn" onClick={() => setActiveModal(null)}>
                  <Icon name="close" size={18} />
                </button>
              </div>
              {logsLoading ? (
                <div className="inline-loader">Đang tải nhật ký...</div>
              ) : syncLogs.length === 0 ? (
                <p style={{ textAlign: 'center', padding: 20, color: '#64748b' }}>Chưa có lịch sử kéo sự kiện.</p>
              ) : (
                <div className="table-wrap">
                  <table className="data-table sa-clean-table">
                    <thead>
                      <tr>
                        <th>Bắt đầu</th>
                        <th>Trạng thái</th>
                        <th>Lượt đọc</th>
                        <th>Lưu mới</th>
                        <th>Chưa map</th>
                      </tr>
                    </thead>
                    <tbody>
                      {syncLogs.map((l) => (
                        <tr key={l._id}>
                          <td>{new Date(l.startedAt).toLocaleString('vi-VN')}</td>
                          <td>{l.status}</td>
                          <td>{l.eventsFetched || 0}</td>
                          <td>{l.eventsIngested || 0}</td>
                          <td>{l.eventsUnmapped || 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>,
          document.body
        )}

      {activeModal === 'unmapped' &&
        selectedDevice &&
        createPortal(
          <div className="account-modal-backdrop" onClick={() => setActiveModal(null)} role="presentation">
            <div className="account-modal-card" style={{ width: 'min(760px, 96vw)' }} onClick={(e) => e.stopPropagation()}>
              <div className="account-modal-header">
                <div>
                  <p className="card-kicker">SỰ KIỆN CHƯA ÁNH XẠ</p>
                  <h2>{selectedDevice.name}</h2>
                </div>
                <button type="button" className="button button-secondary modal-close-btn" onClick={() => setActiveModal(null)}>
                  <Icon name="close" size={18} />
                </button>
              </div>
              {unmappedLoading ? (
                <div className="inline-loader">Đang tải...</div>
              ) : unmappedEvents.length === 0 ? (
                <p style={{ textAlign: 'center', padding: 20, color: '#64748b' }}>Không có sự kiện chưa ánh xạ.</p>
              ) : (
                <div className="table-wrap">
                  <table className="data-table sa-clean-table">
                    <thead>
                      <tr>
                        <th>Thời gian</th>
                        <th>ID trên máy</th>
                        <th>Tên trên máy</th>
                      </tr>
                    </thead>
                    <tbody>
                      {unmappedEvents.map((ev) => (
                        <tr key={ev._id}>
                          <td>{new Date(ev.occurredAt).toLocaleString('vi-VN')}</td>
                          <td><strong>{ev.externalPersonId}</strong></td>
                          <td>{ev.employeeName || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
      {/* ─── BƯỚC 2: MODAL NHẬP MẬT KHẨU KẾT NỐI & GẮN MÁY VỪA TÌM THẤY TRONG LAN ─── */}
      {connectModalTarget &&
        createPortal(
          <div
            className="account-modal-backdrop"
            onClick={() => !connectingDiscovered && setConnectModalTarget(null)}
            role="presentation"
          >
            <form
              className="account-modal-card student-form"
              style={{ width: 'min(540px, 95vw)' }}
              autoComplete="off"
              onClick={(e) => e.stopPropagation()}
              onSubmit={handleConfirmConnectDiscoveredDevice}
            >
              <div className="account-modal-header">
                <div>
                  <p className="card-kicker">BƯỚC 2 · XÁC NHẬN MẬT KHẨU THIẾT BỊ</p>
                  <h2>Kết nối Máy Chấm Công ({connectModalTarget.host})</h2>
                </div>
                <button
                  type="button"
                  className="button button-secondary modal-close-btn"
                  disabled={connectingDiscovered}
                  onClick={() => setConnectModalTarget(null)}
                >
                  <Icon name="close" size={18} />
                </button>
              </div>

              <div
                style={{
                  padding: '11px 14px',
                  marginBottom: 16,
                  borderRadius: 11,
                  background: '#f8fafc',
                  border: '1px solid #dbeafe',
                  fontSize: 13,
                  color: '#334155',
                  lineHeight: 1.5
                }}
              >
                Đã tìm thấy thiết bị <strong>{connectModalTarget.model || 'DS-K1T320MX'}</strong> tại địa chỉ{' '}
                <strong>{connectModalTarget.host}</strong>. Nhập mật khẩu quản trị của máy chấm công để hệ thống khóa bảo mật thiết bị vào phân hiệu <strong>{resolvedSchoolCode}</strong> và tự động kéo dữ liệu về phần mềm.
              </div>

              {connectModalError && (
                <div className="form-error" style={{ marginBottom: 14, fontSize: 13 }}>
                  {connectModalError}
                </div>
              )}

              {/* Chặn trình duyệt tự động chèn tài khoản Web */}
              <input type="text" name="fake_user_autofill" autoComplete="username" tabIndex={-1} aria-hidden="true" style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }} />
              <input type="password" name="fake_pass_autofill" autoComplete="current-password" tabIndex={-1} aria-hidden="true" style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }} />

              <div className="student-form-grid">
                <label className="form-wide">
                  Tên gọi máy chấm công tại phân hiệu *
                  <input
                    required
                    disabled={connectingDiscovered}
                    value={connectForm.name}
                    onChange={(e) => setConnectForm({ ...connectForm, name: e.target.value })}
                    placeholder="VD: Máy chấm công Cổng chính"
                  />
                </label>

                <label>
                  Vị trí lắp đặt
                  <input
                    disabled={connectingDiscovered}
                    value={connectForm.location}
                    onChange={(e) => setConnectForm({ ...connectForm, location: e.target.value })}
                    placeholder="VD: Sảnh đón trẻ"
                  />
                </label>

                <label>
                  Tài khoản quản trị máy *
                  <input
                    required
                    name="hn_connect_dev_user"
                    autoComplete="off"
                    disabled={connectingDiscovered}
                    value={connectForm.username}
                    onChange={(e) => setConnectForm({ ...connectForm, username: e.target.value })}
                    placeholder="admin"
                  />
                </label>

                <label className="form-wide">
                  Mật khẩu máy chấm công *
                  <div className="password-field-group">
                    <input
                      type={connectForm.showPassword ? 'text' : 'password'}
                      name="hn_connect_dev_secret"
                      autoComplete="new-password"
                      autoFocus
                      required
                      disabled={connectingDiscovered}
                      value={connectForm.password}
                      onChange={(e) => setConnectForm({ ...connectForm, password: e.target.value })}
                      placeholder="Nhập mật khẩu quản trị của máy Hikvision"
                    />
                    <button
                      type="button"
                      className="password-field-btn"
                      onClick={() =>
                        setConnectForm((prev) => ({ ...prev, showPassword: !prev.showPassword }))
                      }
                    >
                      <Icon name={connectForm.showPassword ? 'eyeOff' : 'eye'} size={15} />
                      <span>{connectForm.showPassword ? 'Ẩn' : 'Hiện'}</span>
                    </button>
                  </div>
                </label>
              </div>

              <div className="account-modal-actions" style={{ marginTop: 20 }}>
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={connectingDiscovered}
                  onClick={() => setConnectModalTarget(null)}
                >
                  Hủy
                </button>
                <button type="submit" className="button button-primary" disabled={connectingDiscovered}>
                  <Icon name="check" size={16} />
                  <span>
                    {connectingDiscovered
                      ? 'Đang xác thực & kéo dữ liệu...'
                      : 'Xác nhận kết nối & Kéo dữ liệu'}
                  </span>
                </button>
              </div>
            </form>
          </div>,
          document.body
        )}

      {/* ─── MODAL KỸ THUẬT NHÀ CUNG CẤP: GỠ KHÓA MÃ PHẦN CỨNG / CHUYỂN PHÂN HIỆU ─── */}
      {vendorSerialModalDev &&
        isVendorSupport &&
        createPortal(
          <div className="account-modal-backdrop" onClick={() => setVendorSerialModalDev(null)} role="presentation">
            <form
              className="account-modal-card student-form"
              style={{ width: 'min(580px, 96vw)' }}
              onClick={(e) => e.stopPropagation()}
              onSubmit={handleVendorSaveSerialUnlock}
            >
              <div className="account-modal-header">
                <div>
                  <p className="card-kicker">CHỈ DÀNH CHO KỸ THUẬT VIÊN NHÀ CUNG CẤP PHẦN MỀM</p>
                  <h2>Gỡ khóa phần cứng / Chuyển phân hiệu: {vendorSerialModalDev.name}</h2>
                </div>
                <button
                  type="button"
                  className="button button-secondary modal-close-btn"
                  onClick={() => setVendorSerialModalDev(null)}
                >
                  <Icon name="close" size={18} />
                </button>
              </div>

              <div className="student-form-grid">
                <label className="form-wide">
                  Mã phần cứng máy chấm công (Để trống nếu muốn gỡ khóa để nhận máy mới thay thế)
                  <input
                    placeholder="Để trống = gỡ khóa Serial cũ để máy tự nhận Serial mới"
                    value={vendorSerialForm.newSerialNumber}
                    onChange={(e) => setVendorSerialForm({ ...vendorSerialForm, newSerialNumber: e.target.value })}
                  />
                </label>

                <label className="form-wide">
                  Hoặc chuyển giao thiết bị này sang Mã phân hiệu trường khác (Tùy chọn)
                  <input
                    placeholder="VD: HOANANG-B (Để trống nếu giữ nguyên tại phân hiệu hiện tại)"
                    value={vendorSerialForm.targetSchoolCode}
                    onChange={(e) =>
                      setVendorSerialForm({ ...vendorSerialForm, targetSchoolCode: e.target.value.toUpperCase() })
                    }
                  />
                </label>
              </div>

              <div className="account-modal-actions">
                <button type="button" className="button button-secondary" onClick={() => setVendorSerialModalDev(null)}>
                  Hủy
                </button>
                <button type="submit" className="button button-primary" disabled={savingVendorSerial}>
                  {savingVendorSerial ? 'Đang xử lý...' : 'Xác nhận Cập nhật Khóa Phần Cứng'}
                </button>
              </div>
            </form>
          </div>,
          document.body
        )}
    </div>
  );
}
