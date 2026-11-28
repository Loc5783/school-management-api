import { useState, useEffect, useCallback } from 'react';
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
  getSchoolWebhookLogs
} from '../api/timekeeping';
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
    return { label: 'Trực tuyến (ISAPI Ready)', cls: 'hik-status-online' };
  }
  if (status === 'AUTH_FAILED') {
    return { label: 'Sai mật khẩu máy (401)', cls: 'hik-status-auth' };
  }
  if (status === 'OFFLINE' || status === 'ERROR') {
    return { label: 'Ngoại tuyến / Khác lớp LAN', cls: 'hik-status-offline' };
  }
  return { label: 'Chưa kiểm tra ISAPI', cls: 'hik-status-unverified' };
}

export default function TimekeepingDeviceManagement() {
  const currentUser = getStoredUser() || {};
  const storedTenant = getStoredTenant() || {};
  const isAdmin = currentUser.role === 'admin';
  const canManageSync = ['admin', 'principal', 'hr'].includes(currentUser.role);
  const canControlHardware = ['admin', 'principal'].includes(currentUser.role);

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
  const [notice, setNotice] = useState('');
  const [noticeType, setNoticeType] = useState('info');
  const [copiedUrl, setCopiedUrl] = useState(false);

  // Quét mạng LAN & Lưu nhanh 1 chạm
  const [scanningLan, setScanningLan] = useState(false);
  const [lanScanResult, setLanScanResult] = useState(null);
  const [subnetPrefix, setSubnetPrefix] = useState('');
  const [lanProbePassword, setLanProbePassword] = useState('');
  const [quickSavingHost, setQuickSavingHost] = useState('');

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
      const payload = res.data?.data || {};
      if (Array.isArray(payload.school?.campuses) && payload.school.campuses.length > 0) {
        setCampuses(payload.school.campuses);
      }
      if (payload.webhookMeta) {
        setWebhookMeta(payload.webhookMeta);
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
      showToast(err.response?.data?.message || 'Không thể tải dữ liệu máy chấm công của trường', 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedCampus, subjectFilter, faceStatusFilter, appliedSearch, rosterPage, showToast]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadOverview();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadOverview]);

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

  // ─── 1. QUÉT TỰ ĐỘNG TRONG MẠNG LAN & LƯU NHANH 1 CHẠM ───
  const handleScanLan = async () => {
    setScanningLan(true);
    try {
      const res = await discoverLanTimekeepingDevices({
        subnetPrefix: subnetPrefix.trim() || undefined,
        probeUsername: 'admin',
        probePassword: lanProbePassword.trim() || undefined
      });
      setLanScanResult(res.data?.data || null);
      showToast(res.data?.message || 'Đã quét xong mạng LAN!', 'info');
    } catch (err) {
      showToast(err.response?.data?.message || 'Lỗi khi quét mạng LAN', 'error');
    } finally {
      setScanningLan(false);
    }
  };

  const handleQuickSaveDiscoveredDevice = async (item) => {
    if (!lanProbePassword.trim()) {
      handlePickDiscoveredDevice(item);
      return;
    }
    const targetCampus = selectedCampus !== 'ALL' ? selectedCampus : (campuses[0] || 'Cơ sở chính');
    setQuickSavingHost(item.host);
    try {
      const createRes = await createTimekeepingDevice({
        deviceCode: buildAutoDeviceCode(item.host),
        name: `Máy chấm công Hikvision (${item.host})`,
        campus: targetCampus,
        location: 'Sảnh đón trẻ',
        model: item.model || 'DS-K1T320MX',
        serialNumber: item.serialNumber || undefined,
        host: item.host,
        transportScheme: item.transportScheme || 'http',
        httpPort: item.transportScheme === 'http' ? (item.port || 80) : 80,
        httpsPort: item.transportScheme === 'https' ? (item.port || 443) : 443,
        maxUserCapacity: item.maxUserCapacity || 500,
        syncAllocationMode: 'BY_CAMPUS_PRIORITY',
        syncTargetScope: 'ALL',
        autoSyncOnChange: true,
        deviceUsername: 'admin',
        devicePassword: lanProbePassword
      });

      const createdDev = createRes.data?.data;
      if (createdDev?._id) {
        const pullRes = await pullTimekeepingDeviceUsers(createdDev._id, false).catch(() => null);
        if (pullRes?.data?.data) {
          setLastPullReport(pullRes.data.data);
        }
      }

      setLanScanResult((prev) =>
        prev
          ? {
              ...prev,
              discoveredDevices: (prev.discoveredDevices || []).map((d) =>
                d.host === item.host
                  ? { ...d, alreadySaved: true, savedCampus: targetCampus, savedName: `Máy (${item.host})` }
                  : d
              )
            }
          : null
      );
      showToast(`Đã lưu nhanh máy ${item.host} vào ${targetCampus} và kéo thông tin thành công!`, 'success');
      await loadOverview();
    } catch (err) {
      showToast(err.response?.data?.message || 'Không thể lưu nhanh thiết bị này', 'error');
    } finally {
      setQuickSavingHost('');
    }
  };

  const handlePickDiscoveredDevice = (item) => {
    setEditingDeviceId(null);
    const defaultCampus = selectedCampus !== 'ALL' ? selectedCampus : (campuses[0] || 'Cơ sở chính');
    setDeviceForm({
      deviceCode: buildAutoDeviceCode(item.host),
      name: `Máy chấm công Hikvision (${item.host})`,
      campus: defaultCampus,
      location: 'Sảnh đón trẻ',
      model: item.model || 'DS-K1T320MX',
      host: item.host,
      transportScheme: item.transportScheme || 'http',
      port: item.port || 80,
      deviceUsername: 'admin',
      devicePassword: lanProbePassword || '',
      maxUserCapacity: item.maxUserCapacity || 500,
      syncAllocationMode: 'BY_CAMPUS_PRIORITY',
      syncTargetScope: 'ALL',
      autoSyncOnChange: true
    });
    setShowDeviceForm(true);
    showToast(`Đã điền IP ${item.host}. Vui lòng chọn Phân hiệu & nhập mật khẩu máy Hikvision rồi bấm Lưu!`, 'info');
  };

  // ─── 2. THÊM / CẬP NHẬT / XÓA THIẾT BỊ ───
  const openAddDeviceForm = () => {
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
    if (deviceForm.host.trim() === '192.168.1.22') {
      showToast('Địa chỉ IP 192.168.1.22 nằm trong danh sách bảo vệ an toàn của dự án, vui lòng nhập IP máy khác.', 'error');
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
      showToast(err.response?.data?.message || 'Lỗi khi lưu cấu hình máy chấm công', 'error');
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

  // ─── 3. ĐỒNG BỘ NHANH 2 CHIỀU, KÉO NHANH TOÀN CỤM & THAO TÁC PHẦN CỨNG ISAPI ───
  const handleQuickBidirectionalCluster = async (targetDev = null) => {
    if (targetDev) {
      setDeviceActionBusy((prev) => ({ ...prev, [targetDev._id]: 'bisync' }));
      try {
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
        showToast(res.data?.message || 'Đã đồng bộ nhanh 2 chiều thành công!', 'success');
        await loadOverview();
      } catch (err) {
        showToast(err.response?.data?.message || 'Lỗi đồng bộ nhanh 2 chiều', 'error');
      } finally {
        setDeviceActionBusy((prev) => ({ ...prev, [targetDev._id]: null }));
      }
      return;
    }

    setBiSyncingAll(true);
    try {
      const res = await quickBidirectionalSyncDevices({
        campus: selectedCampus !== 'ALL' ? selectedCampus : undefined
      });
      const pullSummary = res.data?.data?.pullSummary;
      if (pullSummary) {
        setLastPullReport({
          deviceName: selectedCampus === 'ALL' ? 'Toàn cụm máy của trường' : `Cụm máy ${selectedCampus}`,
          campus: selectedCampus === 'ALL' ? 'Tất cả phân hiệu' : selectedCampus,
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
      showToast(res.data?.message || 'Đã đồng bộ nhanh 2 chiều toàn cụm máy!', 'success');
      await loadOverview();
    } catch (err) {
      showToast(err.response?.data?.message || 'Lỗi đồng bộ nhanh 2 chiều toàn cụm', 'error');
    } finally {
      setBiSyncingAll(false);
    }
  };

  const handlePullAllFastFromCluster = async () => {
    setPullingAll(true);
    try {
      const res = await pullAllTimekeepingDevicesFast({
        campus: selectedCampus !== 'ALL' ? selectedCampus : undefined,
        overwriteExistingFaces: false,
        includeEvents: true
      });
      const d = res.data?.data;
      if (d) {
        setLastPullReport({
          deviceName: selectedCampus === 'ALL' ? 'Toàn cụm máy của trường' : `Cụm máy ${selectedCampus}`,
          campus: selectedCampus === 'ALL' ? 'Tất cả phân hiệu' : selectedCampus,
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
      showToast(res.data?.message || 'Đã kéo nhanh thông tin & lượt chấm công từ cụm máy về Web!', 'success');
      await loadOverview();
    } catch (err) {
      showToast(err.response?.data?.message || 'Không thể kéo nhanh dữ liệu từ cụm máy', 'error');
    } finally {
      setPullingAll(false);
    }
  };

  const handleCheckCapacity = async (dev) => {
    setDeviceActionBusy((prev) => ({ ...prev, [dev._id]: 'capacity' }));
    try {
      const res = await checkTimekeepingDeviceCapacity(dev._id);
      showToast(
        res.data?.message || 'Đã kiểm tra dung lượng bộ nhớ máy chấm công',
        res.data?.success ? 'success' : 'info'
      );
      await loadOverview();
    } catch (err) {
      showToast(err.response?.data?.message || 'Không thể kết nối ISAPI tới thiết bị', 'error');
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
        `${userRes.data?.message || 'Đã kéo hồ sơ & ảnh khuôn mặt về Web'}${
          ingestedEvents > 0 ? ` • Đồng bộ thêm ${ingestedEvents} lượt chấm công mới!` : ''
        }`,
        'success'
      );
      await loadOverview();
    } catch (err) {
      showToast(err.response?.data?.message || 'Không thể kéo dữ liệu từ máy chấm công', 'error');
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
    if (devOrNull) {
      setDeviceActionBusy((prev) => ({ ...prev, [devOrNull._id]: 'push' }));
      try {
        const res = await pushSmartSyncToDevice(devOrNull._id, {
          fastDelta: !forceFull,
          forceFullSync: Boolean(forceFull)
        });
        showToast(res.data?.message || 'Đã đẩy đồng bộ nhanh xuống máy chấm công!', 'success');
        await loadOverview();
      } finally {
        setDeviceActionBusy((prev) => ({ ...prev, [devOrNull._id]: null }));
      }
    } else {
      setSyncingAll(true);
      try {
        const res = await syncAllTimekeepingDevicesSmart({
          campus: selectedCampus !== 'ALL' ? selectedCampus : undefined,
          fastDelta: !forceFull,
          forceFullSync: Boolean(forceFull)
        });
        showToast(res.data?.message || 'Đã đẩy đồng bộ nhanh tới toàn bộ cụm máy!', 'success');
        await loadOverview();
      } finally {
        setSyncingAll(false);
      }
    }
  };

  const askPruneDevice = (dev) => {
    setConfirmState({
      tone: 'danger',
      badge: 'THU HỒI BỘ NHỚ 500 SLOT — XÓA HỒ SƠ NGHỈ VIỆC / THÔI HỌC',
      title: `Giải phóng slot nghỉ việc & thôi học trên "${dev.name}" (${dev.host})?`,
      description: 'Hệ thống sẽ gửi lệnh ISAPI xóa các mã Nhân sự đã nghỉ việc và Học sinh đã thôi học/ra trường khỏi bộ nhớ phần cứng của chiếc máy này.',
      bullets: [
        `Thu hồi ngay ${kpi.reclaimableInactiveCount || 0} slot của hồ sơ đã nghỉ để dành bộ nhớ 500 slot cho năm học mới.`,
        'Toàn bộ Nhân sự đang làm việc và Học sinh đang theo học được bảo toàn an toàn 100%.'
      ],
      confirmLabel: 'Xác nhận Giải phóng slot nghỉ',
      onExecute: async () => {
        setDeviceActionBusy((prev) => ({ ...prev, [dev._id]: 'prune' }));
        try {
          const res = await pruneTimekeepingDeviceSlots(dev._id);
          showToast(res.data?.message || 'Đã giải phóng slot nghỉ trên máy chấm công!', 'success');
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
      badge: 'AN NINH CỔNG TRƯỜNG — ĐIỀU KHIỂN MỞ CỬA TỪ XA',
      title: `Mở khóa cửa từ xa tại "${dev.name}" (${dev.campus} — ${dev.location})?`,
      description: 'Lệnh ISAPI sẽ kích hoạt rơ-le mở chốt cửa vật lý (Door 1) ngay lập tức.',
      bullets: [
        `Vị trí mở cửa: ${dev.campus} — ${dev.location} (${dev.host}).`,
        'Vui lòng quan sát camera hoặc xác minh phụ huynh / giáo viên trước cửa đón trả trẻ trước khi mở.'
      ],
      confirmLabel: 'Xác nhận Mở cửa ngay',
      onExecute: async () => {
        setDeviceActionBusy((prev) => ({ ...prev, [dev._id]: 'door' }));
        try {
          const res = await unlockTimekeepingDeviceDoor(dev._id, 1);
          showToast(res.data?.message || 'Đã gửi lệnh mở cửa từ xa thành công!', 'success');
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
      const res = await pushSingleBiometricPerson(person.subjectType, person.subjectId);
      showToast(res.data?.message || `Đã đẩy ${person.fullName} xuống máy chấm công!`, 'success');
      await loadOverview();
    } catch (err) {
      showToast(err.response?.data?.message || 'Không thể đẩy hồ sơ xuống máy chấm công', 'error');
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
          className={`hik-alert ${
            noticeType === 'error'
              ? 'hik-alert-error'
              : noticeType === 'success'
                ? 'hik-alert-success'
                : 'hik-alert-info'
          }`}
        >
          <span>{notice}</span>
          <button type="button" className="hik-alert-close" onClick={() => setNotice('')}>
            ✕
          </button>
        </div>
      )}

      {/* ─── KHỐI 1: HEADER QUÉT LAN, ĐỒNG BỘ NHANH 2 CHIỀU, LỌC PHÂN HIỆU & 4 THẺ KPI 500 SLOT ─── */}
      <section className="hik-hero-card">
        <div className="hik-hero-top">
          <div className="hik-hero-title-group">
            <div className="hik-hero-heading-row">
              <h2>Quét Mạng LAN, Đồng Bộ Nhanh 2 Chiều &amp; Quản Lý Bộ Nhớ 500 Slot/Máy</h2>
              <span className="hik-pill-discovery">Hikvision ISAPI Fast 2-Way Sync</span>
            </div>
            <p className="hik-hero-subtitle">
              Quét tự động máy Hikvision trong mạng LAN, kéo nhanh dữ liệu 2 phía (Ảnh khuôn mặt &amp; Lượt chấm công từ Máy ↔ Web) và đẩy nhanh Delta thông minh theo từng Phân hiệu không vượt 500 slot/máy.
            </p>
          </div>

          <div className="hik-hero-actions">
            {canManageSync && (
              <button
                type="button"
                className="hik-btn hik-btn-lan"
                disabled={scanningLan}
                onClick={handleScanLan}
              >
                <Icon name="radar" size={15} />
                <span>{scanningLan ? 'Đang quét LAN...' : 'Quét Máy Trong Mạng LAN'}</span>
              </button>
            )}

            {isAdmin && (
              <button
                type="button"
                className="hik-btn hik-btn-neutral"
                onClick={() => {
                  if (showDeviceForm && !editingDeviceId) {
                    setShowDeviceForm(false);
                  } else {
                    openAddDeviceForm();
                  }
                }}
              >
                <Icon name="plus" size={15} />
                <span>Thêm Máy Thủ Công</span>
              </button>
            )}

            {canManageSync && (
              <button
                type="button"
                className="hik-btn hik-btn-sky"
                disabled={pullingAll || biSyncingAll || devices.length === 0}
                onClick={handlePullAllFastFromCluster}
                title="Kéo nhanh song song cả Ảnh khuôn mặt & Lượt chấm công từ toàn bộ máy về Web"
              >
                <Icon name="download" size={15} />
                <span>{pullingAll ? 'Đang kéo về Web...' : 'Kéo Nhanh Từ Máy Về Web'}</span>
              </button>
            )}

            {canManageSync && (
              <button
                type="button"
                className="hik-btn hik-btn-indigo"
                disabled={syncingAll || biSyncingAll || devices.length === 0}
                onClick={() => askPushSync(null)}
                title="Đẩy nhanh Delta hồ sơ mới & ảnh mặt <200KB từ Web xuống tất cả máy chấm công"
              >
                <Icon name="upload" size={15} />
                <span>{syncingAll ? 'Đang đẩy xuống máy...' : 'Đẩy Nhanh Xuống Tất Cả Máy'}</span>
              </button>
            )}

            {canManageSync && (
              <button
                type="button"
                className="hik-btn hik-btn-emerald"
                disabled={biSyncingAll || syncingAll || pullingAll || devices.length === 0}
                onClick={() => handleQuickBidirectionalCluster(null)}
                title="Đồng bộ nhanh 2 phía chỉ với 1 chạm: Kéo lượt quẹt & ảnh mặt từ máy về Web -> Đẩy hồ sơ & ảnh mặt mới từ Web xuống máy"
              >
                <Icon name="refresh" size={15} />
                <span>{biSyncingAll ? 'Đang đồng bộ 2 phía...' : '⚡ Đồng Bộ Nhanh 2 Chiều'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Thanh chuyển nhanh Phân hiệu / Cơ sở trực thuộc trường */}
        <div className="hik-campus-bar">
          <div className="hik-campus-tabs">
            <span className="hik-campus-label">Phân hiệu quản lý:</span>
            <button
              type="button"
              className={`hik-campus-chip ${selectedCampus === 'ALL' ? 'active' : ''}`}
              onClick={() => {
                setSelectedCampus('ALL');
                setRosterPage(1);
              }}
            >
              Tất cả phân hiệu ({campuses.length})
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
                🏫 {cName}
              </button>
            ))}
          </div>
          <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>
            Mã trường: <strong style={{ color: '#0f172a' }}>{resolvedSchoolCode || '—'}</strong>
          </span>
        </div>

        {/* Kết quả quét mạng LAN tự động & Lưu nhanh 1 chạm */}
        {lanScanResult && (
          <div className="hik-lan-panel">
            <div className="hik-lan-header">
              <div>
                <h4>
                  <Icon name="radar" size={16} />
                  Kết quả Quét Mạng LAN ({lanScanResult.scannedSubnets?.join(', ')}) — Phát hiện{' '}
                  {lanScanResult.discoveredDevices?.length || 0} máy Hikvision
                </h4>
                <p>
                  Nhập sẵn <strong>Mật khẩu máy Hikvision</strong> bên phải để đọc luôn Model/Dung lượng và bấm <strong>&ldquo;⚡ Lưu Nhanh &amp; Kéo DL&rdquo;</strong> chỉ với 1 chạm!
                </p>
              </div>
              <div className="hik-lan-controls">
                <input
                  type="text"
                  value={subnetPrefix}
                  onChange={(e) => setSubnetPrefix(e.target.value)}
                  placeholder="IP / Dải LAN (VD: 192.168.1 hoặc 192.168.1.8)"
                />
                <input
                  type="password"
                  value={lanProbePassword}
                  onChange={(e) => setLanProbePassword(e.target.value)}
                  placeholder="MK máy Hikvision (Lưu 1 chạm)"
                />
                <button
                  type="button"
                  className="hik-btn hik-btn-indigo hik-btn-sm"
                  disabled={scanningLan}
                  onClick={handleScanLan}
                >
                  {scanningLan ? 'Đang quét...' : 'Quét lại'}
                </button>
                <button
                  type="button"
                  className="hik-icon-close"
                  onClick={() => setLanScanResult(null)}
                  aria-label="Đóng kết quả quét LAN"
                >
                  <Icon name="close" size={16} />
                </button>
              </div>
            </div>

            {lanScanResult.discoveredDevices?.length === 0 ? (
              <div style={{ background: '#ffffff', padding: '10px 14px', borderRadius: 10, fontSize: 12, color: '#475569' }}>
                Chưa phát hiện thiết bị Hikvision mở cổng 80/443/8080 trong dải mạng trên. Bạn có thể nhập dải mạng phân hiệu khác (VD: <code>192.168.2</code>, <code>192.168.2.0/24</code> hoặc IP lẻ <code>192.168.1.8</code>) rồi bấm <strong>Quét lại</strong>.
              </div>
            ) : (
              <div className="hik-lan-grid">
                {lanScanResult.discoveredDevices.map((item) => (
                  <div key={`${item.host}:${item.port}`} className="hik-lan-item">
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: 13, color: '#0f172a' }}>
                        {item.transportScheme?.toUpperCase()}://{item.host}:{item.port}
                      </div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>
                        {item.model || item.deviceHint}
                        {item.serialNumber ? ` • SN: ${item.serialNumber}` : ''}
                        {item.currentStoredUsers !== null && item.currentStoredUsers !== undefined
                          ? ` • Đang lưu ${item.currentStoredUsers}/${item.maxUserCapacity || 500} slot`
                          : ''}
                      </div>
                    </div>
                    {item.alreadySaved ? (
                      <span className="hik-status-pill hik-status-online">
                        Đã lưu ({item.savedCampus || item.savedName})
                      </span>
                    ) : isAdmin ? (
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        {lanProbePassword.trim() && (
                          <button
                            type="button"
                            className="hik-btn hik-btn-emerald hik-btn-sm"
                            disabled={quickSavingHost === item.host}
                            onClick={() => handleQuickSaveDiscoveredDevice(item)}
                          >
                            {quickSavingHost === item.host ? 'Đang lưu...' : '⚡ Lưu Nhanh & Kéo DL'}
                          </button>
                        )}
                        <button
                          type="button"
                          className="hik-btn hik-btn-indigo hik-btn-sm"
                          onClick={() => handlePickDiscoveredDevice(item)}
                        >
                          Chọn &amp; Gắn Phân Hiệu
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 4 Thẻ chỉ số 500-Slot */}
        <div className="hik-kpi-grid">
          <div className="hik-kpi-card hik-kpi-slate">
            <p className="hik-kpi-label">Tổng dung lượng Cụm thiết bị</p>
            <p className="hik-kpi-value">
              {kpi.totalDevices} máy ({kpi.totalSlotCapacity} slot)
            </p>
            <p className="hik-kpi-sub">
              {selectedCampus === 'ALL' ? 'Toàn bộ phân hiệu trong trường' : `Phân hiệu: ${selectedCampus}`}
            </p>
          </div>

          <div className="hik-kpi-card hik-kpi-indigo">
            <p className="hik-kpi-label">Nhân sự &amp; Học sinh Active có Mã</p>
            <p className="hik-kpi-value">{kpi.activeWithCodeCount} / 500 slot mỗi máy</p>
            <p className="hik-kpi-sub">
              {kpi.activeStaffCount} nhân sự • {kpi.activeStudentCount} học sinh đang học
            </p>
          </div>

          <div className="hik-kpi-card hik-kpi-emerald">
            <p className="hik-kpi-label">Có Ảnh quét mặt Chấm công</p>
            <p className="hik-kpi-value">{kpi.withBiometricFaceCount} ảnh quét mặt</p>
            <p className="hik-kpi-sub">Chuẩn JPEG nén tự động &lt; 200KB</p>
          </div>

          <div className="hik-kpi-card hik-kpi-rose">
            <p className="hik-kpi-label">Nghỉ việc / Thôi học (Thu hồi slot)</p>
            <p className="hik-kpi-value">{kpi.reclaimableInactiveCount} slot được thu hồi</p>
            <p className="hik-kpi-sub">Sẵn sàng giải phóng khỏi bộ nhớ máy</p>
          </div>
        </div>
      </section>

      {/* ─── FORM THÊM / SỬA MÁY CHẤM CÔNG THEO PHÂN HIỆU ─── */}
      {showDeviceForm && isAdmin && (
        <form className="hik-device-form-card" onSubmit={handleSaveDevice}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <div>
              <h3 style={{ margin: '0 0 3px', fontSize: 15, fontWeight: 800, color: '#0f172a' }}>
                {editingDeviceId
                  ? 'Cập Nhật Cấu Hình Máy Chấm Công & Phân Bổ 500 Slot Theo Phân Hiệu'
                  : 'Đăng Ký Máy Chấm Công Hikvision Mới Cho Phân Hiệu'}
              </h3>
              <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>
                Mật khẩu quản trị ISAPI được mã hóa an toàn AES-256-GCM riêng theo trường {resolvedSchoolCode}.
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
              <label>Địa chỉ IP LAN thiết bị *</label>
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
              <label>Giao thức &amp; Cổng ISAPI</label>
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
                value={deviceForm.deviceUsername}
                onChange={(e) => setDeviceForm({ ...deviceForm, deviceUsername: e.target.value })}
                placeholder="admin"
              />
            </div>

            <div className="hik-field">
              <label>
                Mật khẩu máy Hikvision {editingDeviceId ? '(Để trống nếu giữ nguyên)' : ''}
              </label>
              <input
                type="password"
                value={deviceForm.devicePassword}
                onChange={(e) => setDeviceForm({ ...deviceForm, devicePassword: e.target.value })}
                placeholder={editingDeviceId ? 'Giữ nguyên mật khẩu đã mã hóa' : 'Nhập mật khẩu quản trị thiết bị'}
              />
            </div>
          </div>

          <div className="hik-form-grid-3">
            <div className="hik-field">
              <label>Chiến lược phân bổ bộ nhớ 500 slot</label>
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
              <label>Giới hạn phần cứng (Slot tối đa)</label>
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
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 700, color: '#4338ca', cursor: 'pointer' }}>
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
                className="hik-btn hik-btn-neutral"
                onClick={() => {
                  setShowDeviceForm(false);
                  setEditingDeviceId(null);
                }}
              >
                Hủy
              </button>
              <button type="submit" className="hik-btn hik-btn-indigo" disabled={savingDevice}>
                <Icon name="check" size={15} />
                {savingDevice ? 'Đang lưu & kiểm tra...' : 'Lưu Máy & Kiểm Tra Dung Lượng'}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* ─── KHỐI 2: LƯỚI 2 CỘT THẺ MÁY CHẤM CÔNG HIKVISION ─── */}
      {loading ? (
        <div className="hik-hero-card" style={{ alignItems: 'center', padding: '36px 20px' }}>
          <span className="loading-orb" />
          <span style={{ fontSize: 13, fontWeight: 700, color: '#64748b' }}>
            Đang tải danh sách máy chấm công &amp; hồ sơ khuôn mặt...
          </span>
        </div>
      ) : devices.length === 0 ? (
        <div className="hik-hero-card" style={{ alignItems: 'center', textAlign: 'center', padding: '36px 20px' }}>
          <Icon name="cpu" size={38} />
          <div>
            <h3 style={{ margin: '6px 0', fontSize: 16, fontWeight: 800, color: '#0f172a' }}>
              Chưa có máy chấm công LAN nào tại {selectedCampus === 'ALL' ? 'trường' : selectedCampus}
            </h3>
            <p style={{ margin: '0 auto', maxWidth: 540, fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>
              Bấm <strong>&ldquo;Quét Máy Trong Mạng LAN&rdquo;</strong> để tự động phát hiện thiết bị Hikvision trong mạng nội bộ của phân hiệu, hoặc thêm thủ công địa chỉ IP thiết bị.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
            {canManageSync && (
              <button type="button" className="hik-btn hik-btn-lan" onClick={handleScanLan} disabled={scanningLan}>
                <Icon name="radar" size={15} /> Quét Tự Động Trong Mạng LAN
              </button>
            )}
            {isAdmin && (
              <button type="button" className="hik-btn hik-btn-indigo" onClick={openAddDeviceForm}>
                <Icon name="plus" size={15} /> Thêm Máy Chấm Công Đầu Tiên
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="hik-devices-grid">
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
                <div>
                  <div className="hik-device-card-top">
                    <div style={{ minWidth: 0 }}>
                      <div className="hik-device-badges">
                        <span className={`hik-status-pill ${st.cls}`}>
                          <span className="dot" />
                          {st.label}
                        </span>
                        <span className="hik-endpoint-pill">
                          {scheme}://{dev.host}:{displayPort}
                        </span>
                        <span className="hik-campus-pill">
                          🏫 {dev.campus === 'ALL' ? 'Tất cả phân hiệu' : (dev.campus || 'Cơ sở chính')}
                        </span>
                      </div>
                      <h3 className="hik-device-title">{dev.name}</h3>
                      <p className="hik-device-meta">
                        Vị trí: <strong>{dev.location || 'Sảnh đón trẻ'}</strong> • Model:{' '}
                        <strong>{dev.model || 'DS-K1T320MX'}</strong>
                        {dev.serialNumber ? ` • SN: ${dev.serialNumber}` : ''}
                      </p>
                    </div>

                    <div className="hik-device-icon-actions">
                      <button
                        type="button"
                        className="hik-icon-btn"
                        title="Ánh xạ ID máy với Nhân sự / Học sinh"
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

                  {/* Thanh dung lượng bộ nhớ 500 slot */}
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

                {/* Bộ nút điều khiển phần cứng: Kiểm tra, Kéo nhanh (Máy->Web), Đẩy nhanh (Web->Máy), Đồng bộ 2 chiều, Thu hồi slot, Mở cửa */}
                <div className="hik-device-controls">
                  <button
                    type="button"
                    className="hik-btn hik-btn-neutral hik-btn-sm"
                    disabled={Boolean(busyState)}
                    onClick={() => handleCheckCapacity(dev)}
                  >
                    <Icon name="wifi" size={14} />
                    <span>
                      {busyState === 'capacity' ? 'Đang kiểm tra...' : 'Kiểm tra & Đọc dung lượng'}
                    </span>
                  </button>

                  {canManageSync && (
                    <button
                      type="button"
                      className="hik-btn hik-btn-sky hik-btn-sm"
                      disabled={Boolean(busyState)}
                      onClick={() => askPullUsersFromDevice(dev)}
                      title="Kéo nhanh Ảnh khuôn mặt, Hồ sơ & Lượt chấm công từ máy này về Web"
                    >
                      <Icon name="download" size={14} />
                      <span>
                        {busyState === 'pull'
                          ? 'Đang kéo về Web...'
                          : 'Kéo Nhanh Ảnh Mặt & DL về Web'}
                      </span>
                    </button>
                  )}

                  {canManageSync && (
                    <button
                      type="button"
                      className="hik-btn hik-btn-indigo hik-btn-sm"
                      disabled={Boolean(busyState)}
                      onClick={() => askPushSync(dev)}
                      title="Đẩy nhanh Delta hồ sơ & ảnh khuôn mặt từ Web xuống máy này"
                    >
                      <Icon name="upload" size={14} />
                      <span>
                        {busyState === 'push' ? 'Đang đẩy xuống...' : 'Đẩy Nhanh xuống máy'}
                      </span>
                    </button>
                  )}

                  {canManageSync && (
                    <button
                      type="button"
                      className="hik-btn hik-btn-emerald hik-btn-sm"
                      disabled={Boolean(busyState)}
                      onClick={() => handleQuickBidirectionalCluster(dev)}
                      title="1 chạm đồng bộ cả 2 phía (Kéo từ máy về Web + Đẩy từ Web xuống máy)"
                    >
                      <Icon name="refresh" size={14} />
                      <span>
                        {busyState === 'bisync' ? 'Đang chạy 2 chiều...' : '⚡ Đồng bộ 2 chiều'}
                      </span>
                    </button>
                  )}

                  {canControlHardware && (
                    <button
                      type="button"
                      className="hik-btn hik-btn-soft-amber hik-btn-sm"
                      disabled={Boolean(busyState)}
                      onClick={() => askPruneDevice(dev)}
                    >
                      <Icon name="eraser" size={14} />
                      <span>
                        {busyState === 'prune' ? 'Đang thu hồi...' : 'Giải phóng slot nghỉ'}
                      </span>
                    </button>
                  )}

                  {canControlHardware && (
                    <button
                      type="button"
                      className="hik-btn hik-btn-soft-emerald hik-btn-sm"
                      disabled={Boolean(busyState)}
                      onClick={() => askUnlockDoor(dev)}
                    >
                      <Icon name="unlock" size={14} />
                      <span>{busyState === 'door' ? 'Đang mở cửa...' : 'Mở cửa từ xa'}</span>
                    </button>
                  )}

                  {canControlHardware && (
                    <button
                      type="button"
                      className="hik-btn hik-btn-outline-indigo hik-btn-sm"
                      disabled={Boolean(busyState)}
                      onClick={() => handlePullEventLogsFromMachine(dev)}
                      title="Chỉ kéo riêng lịch sử sự kiện quẹt mặt/thẻ lưu trên máy chấm công"
                    >
                      <Icon name="clock" size={14} />
                      <span>{busyState === 'events' ? 'Đang đọc log...' : 'Kéo lượt chấm công'}</span>
                    </button>
                  )}

                  {dev.unmappedCount > 0 && (
                    <button
                      type="button"
                      className="hik-btn hik-btn-soft-amber hik-btn-sm"
                      onClick={() => openUnmappedModal(dev)}
                    >
                      {dev.unmappedCount} lượt chưa map
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Báo cáo kết quả Kéo Nhanh / Đồng bộ 2 Chiều & Khung Ghép Nhanh 1 Chạm các hồ sơ mới từ máy */}
      {lastPullReport && (
        <section className="hik-pull-banner">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div>
              <h4 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 800, color: '#064e3b' }}>
                ✓ Kết quả kéo &amp; đồng bộ 2 phía tại &ldquo;{lastPullReport.deviceName}&rdquo; ({lastPullReport.campus} • {lastPullReport.host})
              </h4>
              <p style={{ margin: 0, fontSize: 12.5, color: '#065f46' }}>
                Khớp tự động <strong>{lastPullReport.matchedCount || 0} hồ sơ</strong> của trường • Tải về{' '}
                <strong>{lastPullReport.pulledFaceCount || 0} ảnh khuôn mặt (&lt;200KB)</strong>
                {lastPullReport.eventsIngested !== undefined
                  ? ` • Ghi nhận ${lastPullReport.eventsIngested} lượt chấm công / điểm danh mới!`
                  : '!'}
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

          {/* Khung Ghép Nhanh 1 Chạm khi trên máy có người quét mặt trực tiếp bằng ID ngắn (1, 2, 7...) chưa khớp mã Web */}
          {Array.isArray(lastPullReport.unmatchedOnDevice) &&
            lastPullReport.unmatchedOnDevice.length > 0 && (
              <div className="hik-unmatched-box">
                <div style={{ fontSize: 12.5, fontWeight: 800, color: '#92400e' }}>
                  ⚡ Phát hiện {lastPullReport.unmatchedOnDevice.length} hồ sơ đăng ký trực tiếp trên máy chưa khớp Mã Web — Ghép nhanh 1 chạm để lưu luôn Ảnh khuôn mặt &amp; Điểm danh:
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
                            ID trên máy: <code>{u.employeeNo}</code> — {u.name}
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
                          className="hik-btn hik-btn-indigo hik-btn-sm"
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

      {/* ─── KHỐI 3: DẢI WEBHOOK TỰ ĐỘNG ĐUÔI MÃ TRƯỜNG ─── */}
      <section className="hik-webhook-strip">
        <div style={{ flex: '1 1 380px', minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#1d4ed8', textTransform: 'uppercase', marginBottom: 3 }}>
            Đường dẫn HTTP Listening / Webhook nhận sự kiện tự động từ mọi phân hiệu ({resolvedSchoolCode})
          </div>
          <div className="hik-webhook-url-box">
            <Icon name="link" size={15} />
            <code>POST {fullWebhookUrl}</code>
            <button type="button" className="hik-btn hik-btn-neutral hik-btn-sm" onClick={handleCopyWebhookUrl}>
              <Icon name="copy" size={13} /> {copiedUrl ? 'Đã sao chép!' : 'Sao chép URL'}
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {canControlHardware && (
            <button type="button" className="hik-btn hik-btn-outline-indigo hik-btn-sm" onClick={openWebhookSimulator}>
              <Icon name="send" size={14} /> Gửi thử chấm công / điểm danh
            </button>
          )}
          <button type="button" className="hik-btn hik-btn-neutral hik-btn-sm" onClick={openWebhookLogs}>
            <Icon name="fileText" size={14} /> Nhật ký Webhook
          </button>
        </div>
      </section>

      {/* ─── KHỐI 4: BẢNG DANH SÁCH NHÂN SỰ, HỌC SINH & ẢNH QUÉT MẶT CHẤM CÔNG (<200KB) ─── */}
      <section className="hik-roster-card">
        <div className="hik-roster-header">
          <div>
            <h3>
              Danh Sách Nhân Sự, Học Sinh &amp; Ảnh Quét Mặt Chấm Công ({pagination.totalItems} hồ sơ)
            </h3>
            <p>
              <strong>Ảnh quét mặt chấm công</strong> dùng riêng để đẩy xuống máy Hikvision từng phân hiệu (tách biệt hoàn toàn với <strong>Avatar</strong> hiển thị trên Web). Mọi ảnh chụp Camera hoặc chọn file đều tự động nén chuẩn <strong>&lt; 200KB JPG</strong>.
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

            <button type="submit" className="hik-btn hik-btn-neutral hik-btn-sm">
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
                <th>Ảnh Quét Mặt Chấm Công (Hikvision Face)</th>
                <th style={{ textAlign: 'right' }}>Thao tác đồng bộ 1 chiều</th>
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
                              title="Avatar hiển thị trên Web (Tách riêng với ảnh quét mặt chấm công)"
                            />
                          ) : (
                            <span className="hik-avatar-circle">{initialChar}</span>
                          )}
                          <div>
                            <p className="hik-person-name">{item.fullName}</p>
                            <p className="hik-person-sub">
                              {item.subjectType === 'STUDENT' ? '🎒 Học sinh' : '👩‍🏫 Nhân sự'} •{' '}
                              <strong>{item.roleOrClassLabel}</strong> • 🏫 {item.campus}
                            </p>
                          </div>
                        </div>
                      </td>

                      <td>
                        <div className="hik-face-cell">
                          {item.hasBiometricFace && item.faceDataUrl ? (
                            <span className="hik-face-ready-badge">
                              <img src={item.faceDataUrl} alt={`Face ${item.fullName}`} />
                              <span>Đã có ảnh mặt ({item.faceSizeKB}KB &lt;200KB)</span>
                            </span>
                          ) : (
                            <span className="hik-face-empty-badge">Chưa có ảnh quét mặt</span>
                          )}

                          {canManageSync && (
                            <>
                              <button
                                type="button"
                                className="hik-btn hik-btn-indigo hik-btn-sm"
                                disabled={Boolean(busyMode)}
                                onClick={() => setCameraTarget(item)}
                              >
                                <Icon name="camera" size={13} />
                                <span>Chụp Camera</span>
                              </button>

                              <label className="hik-btn hik-btn-outline-indigo hik-btn-sm">
                                <Icon name="upload" size={13} />
                                <span>
                                  {busyMode === 'upload'
                                    ? 'Đang nén...'
                                    : item.hasBiometricFace
                                      ? 'Đổi file'
                                      : 'Chọn file (<200KB)'}
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
                          className="hik-btn hik-btn-soft-indigo hik-btn-sm"
                          disabled={Boolean(busyMode) || devices.length === 0 || !canManageSync}
                          onClick={() => handlePushSinglePerson(item)}
                        >
                          <Icon name="send" size={13} />
                          <span>
                            {busyMode === 'push' ? 'Đang đẩy...' : 'Đẩy xuống máy chấm công'}
                          </span>
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
                className="hik-btn hik-btn-neutral hik-btn-sm"
                disabled={pagination.page <= 1}
                onClick={() => setRosterPage((p) => Math.max(1, p - 1))}
              >
                ← Trang trước
              </button>
              <button
                type="button"
                className="hik-btn hik-btn-neutral hik-btn-sm"
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => setRosterPage((p) => Math.min(pagination.totalPages, p + 1))}
              >
                Trang tiếp →
              </button>
            </div>
          </div>
        )}
      </section>

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
                        showToast(err.response?.data?.message || err.message || 'Thao tác thất bại', 'error');
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
    </div>
  );
}
