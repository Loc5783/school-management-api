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
  importPulledUsersFromDeviceToWeb,
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
  const cleanIp = String(hostStr || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .split(':')[0]
    .split('/')[0];
  const parts = cleanIp.split('.').filter(Boolean);
  if (parts.length === 4 && parts.every((p) => /^\d+$/.test(p))) {
    return `MCC-${parts[2]}-${parts[3]}`;
  }
  const clean = cleanIp.replace(/[^a-zA-Z0-9]/g, '-').toUpperCase().slice(0, 20);
  return clean ? `MCC-${clean}` : `MCC-${Date.now().toString(36).toUpperCase()}`;
}

function formatReadableSerial(serialNumber) {
  const sn = String(serialNumber || '').trim();
  if (!sn) return '';
  // Tách phần đuôi định danh duy nhất của Hikvision (VD: ENLA5403347 / ENGM5583841) để gọn và không bị cắt ngang chữ
  const tailMatch = sn.match(/([A-Z]{2,4}\d{6,10})$/i);
  if (tailMatch) return tailMatch[1].toUpperCase();
  if (sn.length <= 14) return sn;
  return sn.slice(-11);
}

function getDeviceStatusMeta(status) {
  if (status === 'ONLINE') {
    return { label: 'Đang trực tuyến', cls: 'hik-status-online' };
  }
  if (status === 'AUTH_FAILED') {
    return { label: 'Sai mật khẩu máy', cls: 'hik-status-auth' };
  }
  if (status === 'OFFLINE' || status === 'ERROR') {
    return { label: 'Chưa kết nối được', cls: 'hik-status-offline' };
  }
  return { label: 'Chưa kiểm tra', cls: 'hik-status-unverified' };
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

  // Bộ lọc Phân hiệu & Bảng danh sách khuôn mặt trên Web
  const [selectedCampus, setSelectedCampus] = useState('ALL');
  const [subjectFilter, setSubjectFilter] = useState('ALL');
  const [faceStatusFilter, setFaceStatusFilter] = useState('ALL');
  const [syncStatusFilter, setSyncStatusFilter] = useState('ALL');
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [rosterPage, setRosterPage] = useState(1);

  // Bộ lọc cho Bảng Hồ Sơ Thực Tế Đang Lưu Trong Máy Chấm Công
  const [machineFilterId, setMachineFilterId] = useState('ALL');
  const [machineMatchFilter, setMachineMatchFilter] = useState('ALL');
  const [machineSearch, setMachineSearch] = useState('');
  const [importingKey, setImportingKey] = useState('');
  const machineSectionRef = useRef(null);

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
    reclaimableInactiveCount: 0,
    storedOnDevicesCount: 0,
    unmatchedOnDevicesCount: 0
  });
  const [devices, setDevices] = useState([]);
  const [deviceStoredPeople, setDeviceStoredPeople] = useState([]);
  const [roster, setRoster] = useState([]);
  const [quickLinkCandidates, setQuickLinkCandidates] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, totalItems: 0, totalPages: 1 });

  const [loading, setLoading] = useState(true);
  const loadSeqRef = useRef(0);
  const [notice, setNotice] = useState('');
  const [noticeType, setNoticeType] = useState('info');
  const toastTimerRef = useRef(null);
  const [copiedUrl, setCopiedUrl] = useState(false);

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
  const [connectStepLabel, setConnectStepLabel] = useState('');

  // Form Thêm / Sửa máy chấm công
  const [showDeviceForm, setShowDeviceForm] = useState(false);
  const [editingDeviceId, setEditingDeviceId] = useState(null);
  const [savingDevice, setSavingDevice] = useState(false);
  const [deviceForm, setDeviceForm] = useState({
    deviceCode: 'MCC-1-8',
    name: 'Máy chấm công Cổng chính (192.168.1.8)',
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
  const [unmatchedLinkChoice, setUnmatchedLinkChoice] = useState({});
  const [linkingExtKey, setLinkingExtKey] = useState('');
  const [cameraTarget, setCameraTarget] = useState(null);

  // Hộp xác nhận an toàn trước khi đẩy toàn bộ / xóa / mở cửa
  const [confirmState, setConfirmState] = useState(null);
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
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setNotice('');
    }, type === 'error' ? 9000 : 6500);
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
        syncStatus: syncStatusFilter !== 'ALL' ? syncStatusFilter : undefined,
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
      setDeviceStoredPeople(payload.deviceStoredPeople || []);
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
  }, [selectedCampus, subjectFilter, faceStatusFilter, syncStatusFilter, appliedSearch, rosterPage, showToast]);

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
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  // ─── 1. QUÉT TỰ ĐỘNG TRONG MẠNG LAN (BƯỚC 1: QUÉT KHÔNG CẦN MẬT KHẨU -> BƯỚC 2: CHỌN MÁY RỒI NHẬP MẬT KHẨU) ───
  const handleScanLan = async () => {
    if (scanningLan) return;
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
    setConnectStepLabel('');
    setConnectModalTarget(item);
    setConnectForm({
      name: `Máy chấm công (${item.host})`,
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
    setConnectStepLabel('Bước 1/3: Đang xác thực mật khẩu máy chấm công...');

    try {
      const bridgeUp = await refreshConnectorHealth();
      let verifiedModel = item.model || 'DS-K1T320MX';
      let verifiedSerial = item.serialNumber || '';
      let verifiedCapacity = item.maxUserCapacity || 500;
      let inspectedInfo = null;

      // Xác thực mật khẩu trực tiếp với máy chấm công ngay trong mạng LAN trước khi lưu
      if (bridgeUp) {
        inspectedInfo = await verifyDiscoveredDeviceCredentialsViaConnector({
          host: item.host,
          port: item.port || 80,
          transportScheme: item.transportScheme || 'http',
          username: connectForm.username.trim() || 'admin',
          password: connectForm.password
        });
        if (inspectedInfo?.model) verifiedModel = inspectedInfo.model;
        if (inspectedInfo?.serialNumber) verifiedSerial = inspectedInfo.serialNumber;
        if (inspectedInfo?.maxUserCapacity) verifiedCapacity = inspectedInfo.maxUserCapacity;
      }

      setConnectStepLabel('Bước 2/3: Đang gắn & khóa bảo mật máy với phân hiệu...');
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
        devicePassword: connectForm.password,
        connectorVerifiedInfo: inspectedInfo,
        upsertExistingSameCampus: true
      });

      const createdDev = createRes.data?.data;
      let pullMessage = '';
      if (createdDev?._id) {
        setConnectStepLabel('Bước 3/3: Đang đọc danh sách hồ sơ & ảnh khuôn mặt lưu trong máy...');
        if (bridgeUp) {
          const pullRes = await pullDeviceUsersViaLocalConnector(createdDev._id, true, false).catch(() => null);
          pullMessage = pullRes?.message || '';
          await updateWebhookDomainViaLocalConnector(createdDev._id).catch(() => null);
        } else {
          const pullRes = await pullTimekeepingDeviceUsers(createdDev._id, true).catch(() => null);
          pullMessage = pullRes?.data?.message || '';
        }
        setMachineFilterId(createdDev._id);
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
      setConnectStepLabel('');
      await loadOverview();
      showToast(
        pullMessage ||
          `Đã kết nối máy "${cleanDeviceName}" (${item.host}) và đọc xong toàn bộ danh sách hồ sơ đang lưu trong máy!`,
        'success'
      );
    } catch (err) {
      setConnectModalError(
        toFriendlyVietnameseNotice(
          err,
          'Mật khẩu máy chấm công chưa đúng hoặc thiết bị chưa phản hồi. Bạn vui lòng kiểm tra lại mật khẩu rồi thử lại nhé.'
        )
      );
    } finally {
      setConnectingDiscovered(false);
      setConnectStepLabel('');
    }
  };

  // ─── 2. THÊM / CẬP NHẬT / XÓA THIẾT BỊ ───
  const openAddDeviceForm = () => {
    setEditingDeviceId(null);
    const defaultCampus = selectedCampus !== 'ALL' ? selectedCampus : (campuses[0] || 'Cơ sở chính');
    setDeviceForm({
      deviceCode: 'MCC-1-8',
      name: 'Máy chấm công Cổng chính (192.168.1.8)',
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
          const pullOut = await pullDeviceUsersViaLocalConnector(targetDev._id, true, true);
          const pushOut = await pushRosterViaLocalConnector(targetDev._id, { fastDelta: true });
          showToast(
            `Đã đồng bộ 2 chiều xong với "${targetDev.name}": đọc ${pullOut?.data?.totalOnDevice || 0} hồ sơ từ máy & đồng bộ ${pushOut?.data?.syncedUsers || 0} hồ sơ từ Web xuống máy!`,
            'success'
          );
        } else {
          const res = await quickBidirectionalSyncSingleDevice(targetDev._id);
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
        let syncedMachines = 0;
        let totalPulled = 0;
        let totalPushed = 0;
        for (const dev of devices) {
          const pOut = await pullDeviceUsersViaLocalConnector(dev._id, true, true);
          const pushOut = await pushRosterViaLocalConnector(dev._id, { fastDelta: true });
          totalPulled += pOut?.data?.totalOnDevice || 0;
          totalPushed += pushOut?.data?.syncedUsers || 0;
          syncedMachines += 1;
        }
        showToast(
          `Đã đồng bộ 2 chiều hoàn tất cho ${syncedMachines} máy chấm công: đọc ${totalPulled} hồ sơ từ máy & đồng bộ ${totalPushed} lượt hồ sơ từ Web xuống máy!`,
          'success'
        );
      } else {
        const res = await quickBidirectionalSyncDevices({
          campus: selectedCampus !== 'ALL' ? selectedCampus : undefined
        });
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
        let totalOnMachines = 0;
        let totalFaces = 0;
        for (const dev of devices) {
          const out = await pullDeviceUsersViaLocalConnector(dev._id, true, true);
          totalOnMachines += out?.data?.totalOnDevice || 0;
          totalFaces += out?.data?.totalFacesOnDevice || out?.data?.pulledFaceCount || 0;
        }
        setMachineFilterId('ALL');
        await loadOverview();
        showToast(
          `Đã kéo thành công ${totalOnMachines} hồ sơ (${totalFaces} ảnh khuôn mặt) từ ${devices.length} máy chấm công! Bạn có thể xem và bấm "Lấy Ảnh & Tên về Web" ở bảng bên dưới.`,
          'success'
        );
      } else {
        const res = await pullAllTimekeepingDevicesFast({
          campus: selectedCampus !== 'ALL' ? selectedCampus : undefined,
          overwriteExistingFaces: true,
          includeEvents: true
        });
        await loadOverview();
        showToast(res.data?.message || 'Đã kéo xong dữ liệu từ máy chấm công về phần mềm!', 'success');
      }
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

  // Kéo trực tiếp 1 chạm Ảnh + Tên + Hồ sơ từ 1 máy chấm công về Web (không bật popup rườm rà)
  const handleDirectPullFromDevice = async (dev) => {
    setDeviceActionBusy((prev) => ({ ...prev, [dev._id]: 'pull' }));
    try {
      const isBridgeUp = await refreshConnectorHealth();
      if (!isBridgeUp && isPublicCloudWebOrigin()) {
        notifyNeedLocalConnectorOnCloud();
        return;
      }
      if (isBridgeUp) {
        const out = await pullDeviceUsersViaLocalConnector(dev._id, true, true);
        setMachineFilterId(dev._id);
        await loadOverview();
        showToast(
          out?.message ||
            `Đã kéo dữ liệu hồ sơ, tên & ảnh khuôn mặt từ máy "${dev.name}" về phần mềm!`,
          'success'
        );
      } else {
        const [userRes, eventRes] = await Promise.all([
          pullTimekeepingDeviceUsers(dev._id, true),
          syncTimekeepingDevice(dev._id).catch(() => null)
        ]);
        const ingestedEvents = eventRes?.data?.summary?.ingested || 0;
        setMachineFilterId(dev._id);
        await loadOverview();
        showToast(
          `${userRes.data?.message || 'Đã kéo hồ sơ & ảnh khuôn mặt từ máy về phần mềm'}${
            ingestedEvents > 0 ? ` • Cập nhật thêm ${ingestedEvents} lượt điểm danh mới!` : ''
          }`,
          'success'
        );
      }
      window.setTimeout(() => {
        machineSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 120);
    } catch (err) {
      showToast(toFriendlyVietnameseNotice(err, 'Chưa kéo được dữ liệu từ máy chấm công.'), 'error');
    } finally {
      setDeviceActionBusy((prev) => ({ ...prev, [dev._id]: null }));
    }
  };

  // Lấy trực tiếp Ảnh & Tên của 1 người hoặc tất cả người trên máy lưu thẳng vào danh sách Web
  const handleImportFromMachineToWeb = async ({ deviceId, externalPersonIds = [], importAll = false }) => {
    const busyKey = importAll ? `ALL:${deviceId}` : `${deviceId}:${externalPersonIds[0] || ''}`;
    if (importingKey) return;
    setImportingKey(busyKey);
    try {
      if (deviceId === 'ALL_DEVICES') {
        let totalNew = 0;
        let totalUpdated = 0;
        let totalFaces = 0;
        for (const dev of devices) {
          const r = await importPulledUsersFromDeviceToWeb(dev._id, {
            importAll: true,
            overwriteName: true,
            overwriteFace: true
          }).catch(() => null);
          if (r?.data?.data) {
            totalNew += r.data.data.importedNewCount || 0;
            totalUpdated += r.data.data.updatedExistingCount || 0;
            totalFaces += r.data.data.savedFacesCount || 0;
          }
        }
        await loadOverview();
        showToast(
          `Đã lấy dữ liệu từ tất cả máy về Web: thêm mới ${totalNew} hồ sơ, cập nhật ${totalUpdated} hồ sơ và lưu ${totalFaces} ảnh khuôn mặt!`,
          'success'
        );
      } else {
        const res = await importPulledUsersFromDeviceToWeb(deviceId, {
          externalPersonIds,
          importAll,
          overwriteName: true,
          overwriteFace: true
        });
        await loadOverview();
        showToast(res.data?.message || 'Đã lấy Ảnh & Họ tên từ máy chấm công về danh sách Web!', 'success');
      }
    } catch (err) {
      showToast(toFriendlyVietnameseNotice(err, 'Chưa lấy được hồ sơ từ máy về danh sách Web.'), 'error');
    } finally {
      setImportingKey('');
    }
  };

  const handleQuickLinkUnmatchedUser = async (storedItem) => {
    const key = `${storedItem.deviceId}:${storedItem.externalPersonId}`;
    const chosenVal = unmatchedLinkChoice[key];
    if (!chosenVal) {
      showToast('Bạn hãy chọn Học sinh hoặc Nhân sự ở ô bên cạnh trước khi bấm Ghép nhé.', 'info');
      return;
    }
    const [subjectType, subjectId] = chosenVal.split('::');
    setLinkingExtKey(key);
    try {
      const res = await linkPulledTimekeepingUser(storedItem.deviceId, {
        externalPersonId: storedItem.externalPersonId,
        subjectType,
        subjectId,
        faceDataUrl: storedItem.faceDataUrl || ''
      });
      showToast(res.data?.message || 'Đã ghép hồ sơ và lưu ảnh khuôn mặt thành công!', 'success');
      await loadOverview();
    } catch (err) {
      showToast(toFriendlyVietnameseNotice(err, 'Chưa ghép được hồ sơ từ máy chấm công.'), 'error');
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

  const filteredDevicePeople = deviceStoredPeople.filter((sp) => {
    if (machineFilterId !== 'ALL' && sp.deviceId !== machineFilterId) return false;
    if (machineMatchFilter === 'UNMATCHED' && sp.isMatchedOnWeb) return false;
    if (machineMatchFilter === 'MATCHED' && !sp.isMatchedOnWeb) return false;
    if (machineSearch.trim()) {
      const q = machineSearch.trim().toLowerCase();
      const hay = `${sp.externalPersonId} ${sp.nameOnDevice} ${sp.deviceName} ${sp.matchedPersonCode} ${sp.matchedFullName}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const unmatchedDevicePeopleCount = deviceStoredPeople.filter((sp) => {
    if (machineFilterId !== 'ALL' && sp.deviceId !== machineFilterId) return false;
    return !sp.isMatchedOnWeb;
  }).length;

  return (
    <div className="hik-sync-workspace">
      {/* Thông báo nổi góc trên bên phải để người quản lý luôn thấy rõ kết quả dù đang cuộn ở vị trí nào */}
      {notice &&
        createPortal(
          <div
            className={`hik-floating-toast ${
              noticeType === 'error' ? 'error' : noticeType === 'success' ? 'success' : 'info'
            }`}
            role="status"
            aria-live="polite"
          >
            <div style={{ minWidth: 0 }}>{notice}</div>
            <button
              type="button"
              className="hik-alert-close"
              onClick={() => setNotice('')}
              aria-label="Đóng thông báo"
            >
              <Icon name="close" size={14} />
            </button>
          </div>,
          document.body
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

      {/* ─── KHỐI 1: CỤM ĐIỀU KHIỂN CHÍNH, QUÉT MẠNG LAN & 4 CHỈ SỐ DUNG LƯỢNG ─── */}
      <section className="hik-hero-card">
        <div className="hik-cluster-toolbar">
          <div className="hik-hero-title-group">
            <div className="hik-hero-heading-row">
              <h2>Quản Lý Máy Chấm Công &amp; Đồng Bộ 2 Chiều (Web ↔ Máy)</h2>
              <span className="hik-pill-discovery">Khóa bảo mật riêng theo Phân hiệu</span>
            </div>
            <p className="hik-hero-subtitle">
              <strong>Kéo từ máy về Web:</strong> lấy danh sách hồ sơ, họ tên, ảnh khuôn mặt &amp; lượt quẹt đang lưu trong máy.{' '}
              <strong>Đồng bộ Web xuống máy:</strong> nạp danh sách học sinh &amp; nhân sự từ Web xuống bộ nhớ máy chấm công.
            </p>
          </div>

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
                  <span>{showDeviceForm && !editingDeviceId ? 'Đóng biểu mẫu' : 'Thêm máy thủ công'}</span>
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
                    title="Đọc toàn bộ hồ sơ, họ tên, ảnh khuôn mặt & lượt chấm công từ các máy về Web"
                  >
                    <Icon
                      name={pullingAll ? 'refresh' : 'download'}
                      size={15}
                      className={pullingAll ? 'hik-spin' : ''}
                    />
                    <span>{pullingAll ? 'Đang đọc từ máy...' : 'Kéo Ảnh & Tên từ máy về'}</span>
                  </button>

                  <button
                    type="button"
                    className="hik-btn hik-btn-secondary"
                    disabled={syncingAll || pullingAll || biSyncingAll}
                    onClick={() => askPushSync(null)}
                    title="Đồng bộ danh sách Học sinh & Nhân sự từ Web xuống tất cả máy chấm công"
                  >
                    <Icon
                      name={syncingAll ? 'refresh' : 'upload'}
                      size={15}
                      className={syncingAll ? 'hik-spin' : ''}
                    />
                    <span>{syncingAll ? 'Đang đồng bộ xuống...' : 'Đồng bộ Web xuống máy'}</span>
                  </button>

                  <button
                    type="button"
                    className="hik-btn hik-btn-primary"
                    disabled={biSyncingAll || syncingAll || pullingAll}
                    onClick={() => handleQuickBidirectionalCluster(null)}
                    title="Đồng bộ trọn vẹn cả 2 chiều giữa Web và toàn bộ máy chấm công của phân hiệu"
                  >
                    <Icon name="refresh" size={15} className={biSyncingAll ? 'hik-spin' : ''} />
                    <span>{biSyncingAll ? 'Đang chạy 2 chiều...' : 'Đồng bộ 2 chiều'}</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Thanh định danh Phân hiệu đang thao tác */}
        <div className="hik-campus-bar">
          <div className="hik-campus-tabs">
            <span className="hik-campus-label">Phân hiệu đang quản lý:</span>
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
            Mã trường: <strong style={{ color: '#0f172a' }}>{resolvedSchoolCode || '—'}</strong>
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
                <strong>Đang dò tìm tất cả máy chấm công trong mạng nội bộ của trường...</strong>
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

        {/* KẾT QUẢ QUÉT MẠNG LAN (HIỂN THỊ MÃ DÒNG MÁY & SỐ SERI GỌN GÀNG, RÕ NGHĨA) */}
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
                    : 'Chọn máy chấm công tìm thấy bên dưới và bấm "Kết nối & Gắn vào phân hiệu" để nhập mật khẩu máy.'}
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
                {lanScanResult.discoveredDevices.map((item) => {
                  const shortSn = formatReadableSerial(item.serialNumber);
                  return (
                    <div key={`${item.host}:${item.port}`} className="hik-lan-item">
                      <div className="hik-lan-item-main">
                        <span className="hik-lan-device-icon">
                          <Icon name="server" size={20} />
                        </span>
                        <div className="hik-lan-item-copy">
                          <div className="hik-lan-item-title">
                            <span>Máy chấm công Hikvision ({item.host})</span>
                            {!item.lockedToOtherCampus && !item.alreadySaved && (
                              <span className="hik-status-pill hik-status-online" style={{ fontSize: 11 }}>
                                Đang bật trong mạng LAN
                              </span>
                            )}
                          </div>
                          <div className="hik-lan-item-meta" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 5 }}>
                            <span className="hik-code-tag">Dòng máy: {item.model || 'DS-K1T320MX'}</span>
                            <span className="hik-code-tag">Địa chỉ: {item.host}:{item.port || 80}</span>
                            {shortSn && (
                              <span className="hik-code-tag" title={`Số Seri đầy đủ: ${item.serialNumber}`}>
                                Số Seri: {shortSn}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="hik-lan-item-actions">
                        {item.lockedToOtherCampus ? (
                          <span
                            className="hik-status-pill hik-status-offline"
                            title="Thiết bị này đã khóa cho phân hiệu khác để chống kéo/đẩy nhầm"
                          >
                            <Icon name="lock" size={12} /> Đã khóa cho trường khác
                          </span>
                        ) : item.alreadySaved ? (
                          <span className="hik-status-pill hik-status-online">
                            <Icon name="check" size={12} /> Đã kết nối ({item.savedName || item.savedCampus})
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
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 4 Thẻ chỉ số tổng quan hiển thị rõ số liệu cả trên Máy lẫn trên Web */}
        <div className="hik-kpi-grid">
          <div className="hik-kpi-card hik-kpi-slate">
            <p className="hik-kpi-label">Cụm máy chấm công tại trường</p>
            <p className="hik-kpi-value">
              {kpi.totalDevices} máy ({kpi.totalSlotCapacity} vị trí)
            </p>
            <p className="hik-kpi-sub">
              {selectedCampus === 'ALL'
                ? `Phân hiệu: ${storedTenant?.name || campuses[0] || 'Toàn trường'}`
                : `Cơ sở: ${selectedCampus}`}
            </p>
          </div>

          <div
            className="hik-kpi-card hik-kpi-emerald"
            style={{ cursor: deviceStoredPeople.length > 0 ? 'pointer' : 'default' }}
            onClick={() => machineSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            role="presentation"
          >
            <p className="hik-kpi-label">Hồ sơ đang lưu trong máy chấm công</p>
            <p className="hik-kpi-value">{kpi.storedOnDevicesCount || 0} hồ sơ trong máy</p>
            <p className="hik-kpi-sub">
              {kpi.unmatchedOnDevicesCount > 0
                ? `${kpi.unmatchedOnDevicesCount} người trên máy chưa lấy về Web`
                : devices.length > 0
                  ? 'Bấm "Kéo Ảnh & Tên về Web" để đọc từ máy'
                  : 'Kết nối máy để đọc danh sách trong máy'}
            </p>
          </div>

          <div className="hik-kpi-card hik-kpi-indigo">
            <p className="hik-kpi-label">Danh sách trên Web (Nhân sự &amp; Học sinh)</p>
            <p className="hik-kpi-value">{kpi.activeWithCodeCount} / 500 vị trí mỗi máy</p>
            <p className="hik-kpi-sub">
              {kpi.activeStaffCount} nhân sự • {kpi.activeStudentCount} học sinh đang học
            </p>
          </div>

          <div className="hik-kpi-card hik-kpi-rose">
            <p className="hik-kpi-label">Ảnh khuôn mặt sẵn sàng trên Web</p>
            <p className="hik-kpi-value">{kpi.withBiometricFaceCount} ảnh khuôn mặt</p>
            <p className="hik-kpi-sub">
              {kpi.reclaimableInactiveCount > 0
                ? `${kpi.reclaimableInactiveCount} hồ sơ đã nghỉ có thể dọn khỏi máy`
                : 'Ảnh chân dung chuẩn < 200KB để đồng bộ xuống máy'}
            </p>
          </div>
        </div>
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
              <label>Mã quản lý máy trên Web *</label>
              <input
                required
                disabled={Boolean(editingDeviceId)}
                value={deviceForm.deviceCode}
                onChange={(e) => setDeviceForm({ ...deviceForm, deviceCode: e.target.value.toUpperCase() })}
                placeholder="VD: MCC-CONG-1"
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
                          name: `Máy chấm công (${nextHost.trim() || 'LAN'})`
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
                <span>{savingDevice ? 'Đang lưu & kiểm tra...' : 'Lưu cấu hình máy'}</span>
              </button>
            </div>
          </div>
        </form>
      )}

      {/* ─── KHỐI 2: DANH SÁCH THẺ MÁY CHẤM CÔNG CỦA PHÂN HIỆU ─── */}
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
          <div className="hik-hero-card hik-fade-in" style={{ alignItems: 'center', textAlign: 'center', padding: '36px 24px' }}>
            <div
              style={{
                width: 54,
                height: 54,
                borderRadius: 16,
                background: '#eff6ff',
                color: '#2563eb',
                display: 'grid',
                placeItems: 'center'
              }}
            >
              <Icon name="radar" size={25} />
            </div>
            <div>
              <h3 style={{ margin: '6px 0', fontSize: 16, fontWeight: 800, color: '#0f172a' }}>
                Chưa có máy chấm công nào được kết nối vào {selectedCampus === 'ALL' ? 'phân hiệu này' : selectedCampus}
              </h3>
              <p style={{ margin: '0 auto', maxWidth: 540, fontSize: 13, color: '#64748b', lineHeight: 1.55 }}>
                Bấm <strong>&ldquo;Quét tìm máy trong mạng&rdquo;</strong> để phần mềm dò tìm tất cả thiết bị Hikvision đang bật tại trường, sau đó nhập mật khẩu để đọc ngay danh sách hồ sơ lưu trong máy.
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
        <div className="hik-devices-grid hik-fade-in">
          {devices.map((dev) => {
            const st = getDeviceStatusMeta(dev.status);
            const scheme = (dev.transportScheme || 'http').toUpperCase();
            const displayPort = scheme === 'HTTP' ? (dev.httpPort || 80) : (dev.httpsPort || 443);
            const maxCap = Number(dev.maxUserCapacity) || 500;
            const usedSlots = Number(dev.currentStoredUsers || dev.lastSyncSummary?.syncedUsers || 0);
            const usedFaces = Number(dev.currentStoredFaces || 0);
            const usagePercent = Math.min(100, Math.round((usedSlots / maxCap) * 100));
            const allocMeta = ALLOCATION_MODES[dev.syncAllocationMode] || ALLOCATION_MODES.BY_CAMPUS_PRIORITY;
            const busyState = deviceActionBusy[dev._id];
            const shortSerial = formatReadableSerial(dev.serialNumber);

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
                          IP: {dev.host}:{displayPort}
                        </span>
                        <span className="hik-code-tag">
                          Mã máy: {dev.deviceCode}
                        </span>
                        {shortSerial ? (
                          <span
                            className="hik-serial-lock-pill"
                            title={`Đã khóa bảo mật phần cứng với phân hiệu này (Số Seri đầy đủ: ${dev.serialNumber})`}
                          >
                            <Icon name="lock" size={11} /> Seri: {shortSerial}
                          </span>
                        ) : (
                          <span className="hik-serial-lock-pill pending">
                            <Icon name="unlock" size={11} /> Sẽ tự khóa Seri khi kết nối
                          </span>
                        )}
                      </div>
                      <h3 className="hik-device-title">{dev.name}</h3>
                      <p className="hik-device-meta">
                        Vị trí: <strong>{dev.location || 'Sảnh đón trẻ'}</strong> • Dòng máy:{' '}
                        <strong>{dev.model || 'Hikvision Khuôn mặt'}</strong>
                        {dev.webhookConfiguredUrl === fullWebhookUrl ? (
                          <span style={{ color: '#059669', fontWeight: 700 }}> • Đã nhận điểm danh tự động</span>
                        ) : null}
                      </p>
                    </div>

                    <div className="hik-device-icon-actions">
                      <button
                        type="button"
                        className="hik-icon-btn"
                        title="Bảng ánh xạ mã trên máy với Học sinh / Nhân sự"
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

                  {/* Thanh dung lượng thực tế trong bộ nhớ máy chấm công */}
                  <div className="hik-capacity-box" style={{ marginTop: 12 }}>
                    <div className="hik-capacity-row">
                      <span className="hik-capacity-label">
                        <Icon name="hardDrive" size={15} />
                        Đang lưu trong bộ nhớ máy:
                      </span>
                      <span className={`hik-capacity-count ${usagePercent >= 90 ? 'danger' : ''}`}>
                        {usedSlots} / {maxCap} hồ sơ ({usedFaces} ảnh mặt)
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
                        Chế độ: <strong style={{ color: '#334155' }}>{allocMeta.shortLabel}</strong>
                      </span>
                      {dev.statusMessage ? (
                        <span className="hik-capacity-summary">{dev.statusMessage}</span>
                      ) : (
                        <span>Đối tượng: {TARGET_SCOPES[dev.syncTargetScope] || TARGET_SCOPES.ALL}</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* TẦNG 1: 3 NÚT CHÍNH RÕ NGHĨA (KÉO TỪ MÁY VỀ WEB | ĐỒNG BỘ WEB XUỐNG MÁY | ĐỒNG BỘ 2 CHIỀU) */}
                {canManageSync && (
                  <div className="hik-device-primary-actions">
                    <button
                      type="button"
                      className="hik-btn hik-btn-secondary hik-btn-sm"
                      disabled={Boolean(busyState)}
                      onClick={() => handleDirectPullFromDevice(dev)}
                      title="Đọc toàn bộ hồ sơ, họ tên, ảnh khuôn mặt & lượt điểm danh đang có trong máy này về Web"
                    >
                      <Icon
                        name={busyState === 'pull' ? 'refresh' : 'download'}
                        size={14}
                        className={busyState === 'pull' ? 'hik-spin' : ''}
                      />
                      <span>{busyState === 'pull' ? 'Đang kéo về...' : 'Kéo Ảnh & Tên về Web'}</span>
                    </button>

                    <button
                      type="button"
                      className="hik-btn hik-btn-secondary hik-btn-sm"
                      disabled={Boolean(busyState)}
                      onClick={() => askPushSync(dev)}
                      title="Đồng bộ danh sách Học sinh & Nhân sự từ Web xuống chiếc máy này"
                    >
                      <Icon
                        name={busyState === 'push' ? 'refresh' : 'upload'}
                        size={14}
                        className={busyState === 'push' ? 'hik-spin' : ''}
                      />
                      <span>{busyState === 'push' ? 'Đang đẩy xuống...' : 'Đồng bộ Web xuống máy'}</span>
                    </button>

                    <button
                      type="button"
                      className="hik-btn hik-btn-primary hik-btn-sm"
                      disabled={Boolean(busyState)}
                      onClick={() => handleQuickBidirectionalCluster(dev)}
                      title="1 chạm thực hiện cả 2 chiều: Kéo dữ liệu từ máy về Web + Đồng bộ từ Web xuống máy"
                    >
                      <Icon
                        name="refresh"
                        size={14}
                        className={busyState === 'bisync' ? 'hik-spin' : ''}
                      />
                      <span>{busyState === 'bisync' ? 'Đang chạy 2 chiều...' : 'Đồng bộ 2 chiều'}</span>
                    </button>
                  </div>
                )}

                {/* TẦNG 2: THANH TIỆN ÍCH PHẦN CỨNG GỌN GÀNG */}
                <div className="hik-device-utility-bar">
                  <button
                    type="button"
                    className="hik-utility-chip"
                    onClick={() => {
                      setMachineFilterId(dev._id);
                      machineSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }}
                  >
                    <Icon name="users" size={13} />
                    <span>Xem hồ sơ trong máy ({dev.storedSnapshotCount || usedSlots})</span>
                  </button>

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
                    <span>{busyState === 'capacity' ? 'Đang kiểm tra...' : 'Kiểm tra kết nối'}</span>
                  </button>

                  {canControlHardware && (
                    <button
                      type="button"
                      className="hik-utility-chip"
                      disabled={Boolean(busyState)}
                      onClick={() => handlePullEventLogsFromMachine(dev)}
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
                    >
                      <Icon
                        name={busyState === 'webhook' ? 'refresh' : 'globe'}
                        size={13}
                        className={busyState === 'webhook' ? 'hik-spin' : ''}
                      />
                      <span>{busyState === 'webhook' ? 'Đang cập nhật...' : 'Cập nhật tên miền Web'}</span>
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
      )}

      {/* ─── KHỐI 3: HỒ SƠ ĐANG LƯU TRONG MÁY CHẤM CÔNG (HIỂN THỊ RÕ ẢNH + TÊN + MÃ TRÊN MÁY & 1 CHẠM LẤY VỀ WEB) ─── */}
      {devices.length > 0 && (
        <section ref={machineSectionRef} className="hik-machine-roster-card hik-fade-in">
          <div className="hik-machine-roster-head">
            <div className="hik-machine-roster-top">
              <div>
                <h3>
                  <Icon name="hardDrive" size={18} />
                  <span>Hồ Sơ Đang Lưu Trong Máy Chấm Công ({filteredDevicePeople.length} hồ sơ)</span>
                  {unmatchedDevicePeopleCount > 0 && (
                    <span className="hik-match-status unmatched" style={{ fontSize: 11.5 }}>
                      {unmatchedDevicePeopleCount} hồ sơ trên máy chưa có trên Web
                    </span>
                  )}
                </h3>
                <p>
                  Danh sách người dùng, <strong>họ tên</strong> và <strong>ảnh khuôn mặt thật</strong> đọc trực tiếp từ bộ nhớ máy chấm công. Muốn đưa hồ sơ từ máy về Web, bạn chỉ cần bấm <strong>&ldquo;Lấy Ảnh &amp; Tên về Web&rdquo;</strong>.
                </p>
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {canManageSync && (
                  <button
                    type="button"
                    className="hik-btn hik-btn-secondary hik-btn-sm"
                    disabled={pullingAll}
                    onClick={() => {
                      if (machineFilterId !== 'ALL') {
                        const targetDev = devices.find((d) => d._id === machineFilterId);
                        if (targetDev) {
                          void handleDirectPullFromDevice(targetDev);
                          return;
                        }
                      }
                      void handlePullAllFastFromCluster();
                    }}
                  >
                    <Icon name={pullingAll ? 'refresh' : 'download'} size={14} className={pullingAll ? 'hik-spin' : ''} />
                    <span>{pullingAll ? 'Đang đọc từ máy...' : 'Đọc lại dữ liệu từ máy'}</span>
                  </button>
                )}

                {canManageSync && filteredDevicePeople.length > 0 && (
                  <button
                    type="button"
                    className="hik-btn hik-btn-primary hik-btn-sm"
                    disabled={Boolean(importingKey)}
                    onClick={() =>
                      handleImportFromMachineToWeb({
                        deviceId: machineFilterId === 'ALL' ? 'ALL_DEVICES' : machineFilterId,
                        importAll: true
                      })
                    }
                  >
                    <Icon name={importingKey ? 'refresh' : 'check'} size={14} className={importingKey ? 'hik-spin' : ''} />
                    <span>
                      {importingKey
                        ? 'Đang lưu về Web...'
                        : `Lấy tất cả Ảnh & Tên về Web (${filteredDevicePeople.length})`}
                    </span>
                  </button>
                )}
              </div>
            </div>

            {/* Bộ lọc theo từng máy chấm công & trạng thái khớp */}
            <div className="hik-device-filter-bar">
              <div className="hik-filter-pills">
                <button
                  type="button"
                  className={`hik-filter-pill ${machineFilterId === 'ALL' ? 'active' : ''}`}
                  onClick={() => setMachineFilterId('ALL')}
                >
                  Tất cả máy ({deviceStoredPeople.length})
                </button>
                {devices.map((d) => {
                  const countOnDev = deviceStoredPeople.filter((x) => x.deviceId === d._id).length;
                  return (
                    <button
                      key={d._id}
                      type="button"
                      className={`hik-filter-pill ${machineFilterId === d._id ? 'active' : ''}`}
                      onClick={() => setMachineFilterId(d._id)}
                    >
                      {d.name} ({countOnDev})
                    </button>
                  );
                })}
              </div>

              <div className="hik-roster-filters">
                <select
                  value={machineMatchFilter}
                  onChange={(e) => setMachineMatchFilter(e.target.value)}
                >
                  <option value="ALL">Tất cả trạng thái ({deviceStoredPeople.length})</option>
                  <option value="UNMATCHED">Chưa có trên Web ({kpi.unmatchedOnDevicesCount || 0})</option>
                  <option value="MATCHED">Đã khớp với Web</option>
                </select>
                <input
                  type="search"
                  value={machineSearch}
                  onChange={(e) => setMachineSearch(e.target.value)}
                  placeholder="Tìm mã trên máy, họ tên..."
                />
              </div>
            </div>
          </div>

          <div className="hik-roster-table-wrap">
            <table className="hik-roster-table">
              <thead>
                <tr>
                  <th>Mã trên máy &amp; Thiết bị</th>
                  <th>Ảnh Khuôn Mặt &amp; Họ Tên Trên Máy</th>
                  <th>Trạng thái trên Web</th>
                  <th style={{ textAlign: 'right' }}>Lấy dữ liệu từ máy về Web</th>
                </tr>
              </thead>
              <tbody>
                {deviceStoredPeople.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', padding: '28px 16px', color: '#475569' }}>
                      Chưa đọc danh sách hồ sơ từ bộ nhớ máy chấm công. Bạn hãy bấm nút{' '}
                      <strong>&ldquo;Kéo Ảnh &amp; Tên về Web&rdquo;</strong> trên thẻ máy (hoặc{' '}
                      <strong>&ldquo;Đọc lại dữ liệu từ máy&rdquo;</strong> ở góc trên) để hiển thị toàn bộ hồ sơ trong máy nhé!
                    </td>
                  </tr>
                ) : filteredDevicePeople.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', padding: '24px 16px', color: '#64748b' }}>
                      Không có hồ sơ nào trên máy khớp với bộ lọc tìm kiếm hiện tại.
                    </td>
                  </tr>
                ) : (
                  filteredDevicePeople.map((sp) => {
                    const rowKey = `${sp.deviceId}:${sp.externalPersonId}`;
                    const isImportingThis = importingKey === rowKey;
                    const initial = String(sp.nameOnDevice || sp.externalPersonId || 'M').charAt(0).toUpperCase();

                    return (
                      <tr key={rowKey}>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                            <span className="hik-machine-id-badge">Mã máy: {sp.externalPersonId}</span>
                            <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>
                              {sp.deviceName} ({sp.deviceHost})
                            </span>
                          </div>
                        </td>

                        <td>
                          <div className="hik-person-cell">
                            {sp.faceDataUrl ? (
                              <img
                                src={sp.faceDataUrl}
                                alt={sp.nameOnDevice}
                                style={{
                                  width: 40,
                                  height: 40,
                                  borderRadius: 10,
                                  objectFit: 'cover',
                                  border: '1.5px solid #6ee7b7',
                                  flexShrink: 0
                                }}
                              />
                            ) : (
                              <span className="hik-avatar-circle" style={{ width: 40, height: 40 }}>
                                {initial}
                              </span>
                            )}
                            <div>
                              <p className="hik-person-name">{sp.nameOnDevice}</p>
                              <p className="hik-person-sub">
                                {sp.faceDataUrl
                                  ? `Có ảnh khuôn mặt trên máy (${sp.faceSizeKB}KB)`
                                  : sp.hasFaceOnDevice
                                    ? 'Đã đăng ký khuôn mặt trên máy'
                                    : 'Chưa có ảnh khuôn mặt trên máy'}
                              </p>
                            </div>
                          </div>
                        </td>

                        <td>
                          {sp.isMatchedOnWeb ? (
                            <span className="hik-match-status matched">
                              <Icon name="check" size={13} />
                              <span>
                                Đã khớp: [{sp.matchedPersonCode}] {sp.matchedFullName}
                              </span>
                            </span>
                          ) : (
                            <span className="hik-match-status unmatched">
                              <span>Mới chỉ có trong máy — Chưa lưu về Web</span>
                            </span>
                          )}
                        </td>

                        <td style={{ textAlign: 'right' }}>
                          {canManageSync && (
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                              <button
                                type="button"
                                className={`hik-btn ${sp.isMatchedOnWeb ? 'hik-btn-secondary' : 'hik-btn-primary'} hik-btn-sm`}
                                disabled={Boolean(importingKey)}
                                onClick={() =>
                                  handleImportFromMachineToWeb({
                                    deviceId: sp.deviceId,
                                    externalPersonIds: [sp.externalPersonId],
                                    importAll: false
                                  })
                                }
                              >
                                <Icon
                                  name={isImportingThis ? 'refresh' : 'download'}
                                  size={13}
                                  className={isImportingThis ? 'hik-spin' : ''}
                                />
                                <span>
                                  {isImportingThis
                                    ? 'Đang lấy...'
                                    : sp.isMatchedOnWeb
                                      ? 'Cập nhật Ảnh & Tên về Web'
                                      : 'Lấy Ảnh & Tên về Web'}
                                </span>
                              </button>

                              {!sp.isMatchedOnWeb && quickLinkCandidates.length > 0 && (
                                <>
                                  <select
                                    className="hik-unmatched-select"
                                    style={{ maxWidth: 210, padding: '6px 8px', fontSize: 11.5 }}
                                    value={unmatchedLinkChoice[rowKey] || ''}
                                    onChange={(e) =>
                                      setUnmatchedLinkChoice((prev) => ({
                                        ...prev,
                                        [rowKey]: e.target.value
                                      }))
                                    }
                                  >
                                    <option value="">-- Hoặc ghép vào HS/NS sẵn có --</option>
                                    {quickLinkCandidates.map((cand) => (
                                      <option
                                        key={`${cand.subjectType}::${cand.subjectId}`}
                                        value={`${cand.subjectType}::${cand.subjectId}`}
                                      >
                                        [{cand.subjectType === 'STUDENT' ? 'HS' : 'NS'}] {cand.personCode} — {cand.fullName}
                                      </option>
                                    ))}
                                  </select>
                                  {unmatchedLinkChoice[rowKey] && (
                                    <button
                                      type="button"
                                      className="hik-btn hik-btn-secondary hik-btn-sm"
                                      disabled={linkingExtKey === rowKey}
                                      onClick={() => handleQuickLinkUnmatchedUser(sp)}
                                    >
                                      {linkingExtKey === rowKey ? 'Đang ghép...' : 'Xác nhận ghép'}
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ─── KHỐI 4: DANH SÁCH HỒ SƠ TRÊN WEB & ĐỒNG BỘ XUỐNG MÁY CHẤM CÔNG ─── */}
      <section className="hik-roster-card">
        <div className="hik-roster-header">
          <div>
            <h3>
              Danh Sách Hồ Sơ Trên Web &amp; Đồng Bộ Xuống Máy ({pagination.totalItems} hồ sơ)
            </h3>
            <p>
              Danh sách Học sinh &amp; Nhân sự của phân hiệu trên phần mềm Web. Bấm <strong>&ldquo;Chụp Camera&rdquo;</strong> hoặc <strong>&ldquo;Chọn ảnh&rdquo;</strong> để gắn ảnh khuôn mặt chuẩn <code>&lt; 200KB</code>, sau đó bấm <strong>&ldquo;Đồng bộ xuống máy&rdquo;</strong>.
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
              value={syncStatusFilter}
              onChange={(e) => {
                setSyncStatusFilter(e.target.value);
                setRosterPage(1);
              }}
            >
              <option value="ALL">Tất cả trạng thái máy</option>
              <option value="ON_DEVICE">Đã có trên máy chấm công</option>
              <option value="NOT_ON_DEVICE">Chưa đồng bộ xuống máy</option>
            </select>

            <select
              value={faceStatusFilter}
              onChange={(e) => {
                setFaceStatusFilter(e.target.value);
                setRosterPage(1);
              }}
            >
              <option value="ALL">Tất cả trạng thái ảnh</option>
              <option value="WITH_FACE">Đã có ảnh khuôn mặt</option>
              <option value="MISSING_FACE">Chưa có ảnh khuôn mặt</option>
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
                <th>Họ tên &amp; Lớp / Bộ phận</th>
                <th>Ảnh Khuôn Mặt Chấm Công</th>
                <th>Trạng thái trên máy</th>
                <th style={{ textAlign: 'right' }}>Đồng bộ Web → Máy</th>
              </tr>
            </thead>
            <tbody>
              {roster.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '28px 16px', color: '#64748b' }}>
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
                              <span>Đã có ảnh ({item.faceSizeKB}KB)</span>
                            </span>
                          ) : (
                            <span className="hik-face-empty-badge">Chưa có ảnh mặt</span>
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

                      <td>
                        {item.isOnDevice ? (
                          <span
                            className="hik-sync-badge synced"
                            title={item.syncedDeviceNames?.join(', ') || 'Đã đồng bộ xuống máy chấm công'}
                          >
                            <Icon name="check" size={12} />
                            <span>Đã có trên máy ({item.syncedDeviceCount || 1})</span>
                          </span>
                        ) : (
                          <span className="hik-sync-badge unsynced">Chưa đẩy xuống máy</span>
                        )}
                      </td>

                      <td style={{ textAlign: 'right' }}>
                        <button
                          type="button"
                          className="hik-btn hik-btn-secondary hik-btn-sm"
                          disabled={Boolean(busyMode) || devices.length === 0 || !canManageSync}
                          onClick={() => handlePushSinglePerson(item)}
                          title={
                            devices.length === 0
                              ? 'Cần kết nối ít nhất 1 máy chấm công trước khi đồng bộ xuống máy'
                              : 'Đồng bộ hồ sơ & ảnh khuôn mặt của người này từ Web xuống máy chấm công'
                          }
                        >
                          <Icon
                            name={busyMode === 'push' ? 'refresh' : 'upload'}
                            size={13}
                            className={busyMode === 'push' ? 'hik-spin' : ''}
                          />
                          <span>{busyMode === 'push' ? 'Đang đồng bộ...' : 'Đồng bộ xuống máy'}</span>
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

      {/* ─── KHỐI 5: ĐỊA CHỈ NHẬN ĐIỂM DANH TỰ ĐỘNG THEO TÊN MIỀN & THÔNG BÁO TRỰC TIẾP ─── */}
      <section className="hik-webhook-strip">
        <div style={{ flex: '1 1 420px', minWidth: 0 }}>
          <div style={{ fontSize: 11.5, fontWeight: 800, color: '#1d4ed8', textTransform: 'uppercase', marginBottom: 4 }}>
            Địa chỉ nhận điểm danh tự động theo tên miền hiện tại ({resolvedSchoolCode})
          </div>
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

      {liveFeedEvents.length > 0 && (
        <section className="hik-live-feed-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 13.5, color: '#0f172a', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <Icon name="bell" size={15} />
              <span>Thông báo điểm danh &amp; đồng bộ trực tiếp tại phân hiệu ({resolvedSchoolCode})</span>
            </strong>
            <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>Cập nhật theo thời gian thực</span>
          </div>
          <div className="hik-live-feed-list">
            {liveFeedEvents.slice(0, 6).map((ev) => (
              <div key={ev.id} className={`hik-live-event-item ${ev.tone || 'info'}`}>
                <div style={{ minWidth: 0 }}>
                  <strong style={{ display: 'block', color: '#0f172a', marginBottom: 2 }}>{ev.title}</strong>
                  <span style={{ color: '#334155' }}>{ev.message}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
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

      {/* ─── MODAL XÁC NHẬN AN TOÀN PHẦN CỨNG (PULL / PUSH / PRUNE / DOOR / DELETE — Bấm ngoài KHÔNG tắt) ─── */}
      {confirmState &&
        createPortal(
          <div className="hik-modal-backdrop" role="presentation">
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
                      <strong>Ép nạp lại toàn bộ 100% hồ sơ &amp; ảnh mặt</strong> (Mặc định không tích sẽ dùng chế độ <strong>Đồng bộ Nhanh</strong> chỉ đẩy những hồ sơ mới/thay đổi để hoàn tất trong vài giây).
                    </span>
                  </label>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 6 }}>
                  <button
                    type="button"
                    className="hik-btn hik-btn-secondary"
                    onClick={() => setConfirmState(null)}
                  >
                    Hủy bỏ
                  </button>
                  <button
                    type="button"
                    className={`hik-btn ${confirmState.tone === 'danger' ? 'hik-btn-danger' : 'hik-btn-primary'}`}
                    onClick={async () => {
                      const current = confirmState;
                      setConfirmState(null);
                      try {
                        if (current.mode === 'PUSH_SYNC') {
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

      {/* ─── MODAL GIẢ LẬP WEBHOOK (Bấm ngoài KHÔNG tắt) ─── */}
      {activeModal === 'simulate_webhook' &&
        createPortal(
          <div className="account-modal-backdrop" role="presentation">
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

      {/* ─── MODAL ÁNH XẠ ID MÁY THỦ CÔNG (Chỉ bấm ngoài tắt nếu chỉ xem, Admin có quyền thêm/xóa thì KHÔNG tắt) ─── */}
      {activeModal === 'mappings' &&
        selectedDevice &&
        createPortal(
          <div
            className="account-modal-backdrop"
            onClick={!isAdmin ? () => setActiveModal(null) : undefined}
            role="presentation"
          >
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
      {/* ─── BƯỚC 2: MODAL NHẬP MẬT KHẨU KẾT NỐI & GẮN MÁY VỪA TÌM THẤY TRONG LAN (Bấm ngoài KHÔNG tắt) ─── */}
      {connectModalTarget &&
        createPortal(
          <div
            className="account-modal-backdrop"
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
                Thiết bị <strong>{connectModalTarget.model || 'DS-K1T320MX'}</strong> tại địa chỉ{' '}
                <strong>{connectModalTarget.host}</strong>
                {connectModalTarget.serialNumber
                  ? ` (Số Seri: ${formatReadableSerial(connectModalTarget.serialNumber)})`
                  : ''}
                . Nhập mật khẩu quản trị của máy chấm công để khóa bảo mật thiết bị vào phân hiệu{' '}
                <strong>{resolvedSchoolCode}</strong> và đọc ngay danh sách hồ sơ đang lưu trong máy.
              </div>

              {connectModalError && (
                <div className="form-error" style={{ marginBottom: 14, fontSize: 13 }}>
                  {connectModalError}
                </div>
              )}

              {connectingDiscovered && connectStepLabel && (
                <div
                  style={{
                    marginBottom: 14,
                    padding: '10px 14px',
                    borderRadius: 10,
                    background: '#eff6ff',
                    border: '1px solid #93c5fd',
                    color: '#1d4ed8',
                    fontSize: 12.5,
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8
                  }}
                >
                  <Icon name="refresh" size={14} className="hik-spin" />
                  <span>{connectStepLabel}</span>
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

      {/* ─── MODAL KỸ THUẬT NHÀ CUNG CẤP: GỠ KHÓA MÃ PHẦN CỨNG / CHUYỂN PHÂN HIỆU (Bấm ngoài KHÔNG tắt) ─── */}
      {vendorSerialModalDev &&
        isVendorSupport &&
        createPortal(
          <div className="account-modal-backdrop" role="presentation">
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
