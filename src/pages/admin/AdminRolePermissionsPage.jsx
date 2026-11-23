import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from 'firebase/firestore';
import {
  AlertTriangle,
  ArrowRightLeft,
  Download,
  Lock,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  X
} from 'lucide-react';
import AppShell from '../../components/AppShell.jsx';
import ConfirmSheet from '../../components/ConfirmSheet.jsx';
import BottomSheet from '../../components/users/BottomSheet.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useData } from '../../context/DataContext.jsx';
import { db, OperationType, handleFirestoreError } from '../../firebase/config.js';
import {
  HOME_ROUTES,
  PERMISSION_DEFINITIONS,
  REVIEW_KINDS,
  REVIEW_SCOPES,
  ROLE_KEY_REGEX,
  exportRoles,
  getRoleList,
  parseRolesImport,
  validateRoleDefinition
} from '../../lib/permissions.js';

const SCOPE_LABELS = {
  none: 'Denied',
  self: 'Self',
  office: 'Office',
  subtree: 'Subtree',
  all: 'All'
};

const REVIEW_SCOPE_LABELS = {
  none: 'None',
  office: 'Office',
  subtree: 'Subtree',
  all: 'All'
};

const REVIEW_KIND_LABELS = {
  leave: 'Leave Review',
  fieldduty: 'Field Duty Review',
  settle: 'Attendance Settlement'
};

const HOME_ROUTE_LABELS = {
  '': 'Auto (Derived from permissions)',
  admin: 'Admin Dashboard (/admin)',
  district: 'Review & Settlement (/district)',
  'office-head': 'Office Reports & Review (/office-head)',
  'head-office': 'Executive Overview (/head-office)',
  employee: 'Self-Service Attendance (/employee)'
};

const CATEGORIES = ['All', 'Attendance', 'Leave & Field Duty', 'Reports', 'Users & Devices', 'System & Audit'];

function buildDraftFromRole(role) {
  if (!role) {
    return {
      key: '',
      label: '',
      description: '',
      rank: 10,
      homeRoute: '',
      isSuper: false,
      chargeEligible: false,
      actingEligible: false,
      permissions: {},
      review: { leave: {}, fieldduty: {}, settle: {} }
    };
  }
  return {
    key: role.key,
    label: role.label || '',
    description: role.description || '',
    rank: Number.isInteger(role.rank) ? role.rank : 10,
    homeRoute: role.homeRoute || '',
    isSuper: Boolean(role.isSuper),
    chargeEligible: Boolean(role.chargeEligible),
    actingEligible: Boolean(role.actingEligible),
    permissions: { ...(role.permissions || {}) },
    review: {
      leave: { ...(role.review?.leave || {}) },
      fieldduty: { ...(role.review?.fieldduty || {}) },
      settle: { ...(role.review?.settle || {}) }
    }
  };
}

function serializeRoleDraft(draft) {
  if (!draft) return '';
  const sortObj = (obj) =>
    Object.keys(obj || {})
      .sort()
      .reduce((acc, k) => {
        if (obj[k] && obj[k] !== 'none') acc[k] = obj[k];
        return acc;
      }, {});
  return JSON.stringify({
    key: draft.key || '',
    label: (draft.label || '').trim(),
    description: (draft.description || '').trim(),
    rank: Number(draft.rank) || 0,
    homeRoute: draft.homeRoute || '',
    isSuper: Boolean(draft.isSuper),
    chargeEligible: Boolean(draft.chargeEligible),
    actingEligible: Boolean(draft.actingEligible),
    permissions: sortObj(draft.permissions),
    review: {
      leave: sortObj(draft.review?.leave),
      fieldduty: sortObj(draft.review?.fieldduty),
      settle: sortObj(draft.review?.settle)
    }
  });
}

function toFirestoreRolePayload(normalized) {
  return {
    key: normalized.key,
    label: normalized.label,
    description: normalized.description || '',
    rank: normalized.rank,
    isSuper: Boolean(normalized.isSuper),
    chargeEligible: Boolean(normalized.chargeEligible),
    actingEligible: Boolean(normalized.actingEligible),
    homeRoute: normalized.homeRoute || '',
    permissions: normalized.permissions || {},
    review: {
      leave: normalized.review?.leave || {},
      fieldduty: normalized.review?.fieldduty || {},
      settle: normalized.review?.settle || {}
    }
  };
}

export default function AdminRolePermissionsPage() {
  const {
    firebaseUser,
    profile,
    roles,
    roleRegistry,
    defaultRoleKey,
    registrationOpen,
    isBootstrapSuperAdmin,
    roleMeta,
    can,
    permissionScope
  } = useAuth();
  const { logAudit } = useData();

  const roleList = useMemo(() => getRoleList(roleRegistry), [roleRegistry]);
  const actorUid = profile?.uid || firebaseUser?.uid || '';
  const auditActor = useMemo(
    () => ({
      uid: actorUid,
      ...(profile || {}),
      email: profile?.email || firebaseUser?.email || '',
      isBootstrapSuper: isBootstrapSuperAdmin
    }),
    [actorUid, profile, firebaseUser?.email, isBootstrapSuperAdmin]
  );

  const canManageRoles =
    isBootstrapSuperAdmin ||
    (Boolean(roleMeta?.isSuper) && permissionScope('settings.manage') === 'all') ||
    can('settings.manage');
  const callerRank = isBootstrapSuperAdmin ? 1000 : roleMeta?.rank ?? 0;
  const canInspectUsers = isBootstrapSuperAdmin || permissionScope('user.view') === 'all';
  const canRemapUsers =
    isBootstrapSuperAdmin ||
    (Boolean(roleMeta?.isSuper) && permissionScope('user.role.assign') === 'all');

  const [selectedRole, setSelectedRole] = useState('');
  const [draft, setDraft] = useState(() => buildDraftFromRole(null));
  const [workspaceTab, setWorkspaceTab] = useState('permissions'); // 'permissions' | 'review' | 'meta'
  const [reviewKind, setReviewKind] = useState('leave');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');

  const [saving, setSaving] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Default role bar state
  const [defaultRoleDraft, setDefaultRoleDraft] = useState(defaultRoleKey || '');
  const [savingDefaultRole, setSavingDefaultRole] = useState(false);

  // Create Role modal state
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState(() => buildDraftFromRole(null));
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);

  // Delete Role state
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [checkingDelete, setCheckingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // JSON Import modal state
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importOverwriteConfirmed, setImportOverwriteConfirmed] = useState(false);
  const [importError, setImportError] = useState('');
  const [importing, setImporting] = useState(false);

  // Unresolved roles panel state
  const [scanningUnresolved, setScanningUnresolved] = useState(false);
  const [unresolvedError, setUnresolvedError] = useState('');
  const [unresolvedGroups, setUnresolvedGroups] = useState([]);
  const [hasScannedUnresolved, setHasScannedUnresolved] = useState(false);
  const [remapTargets, setRemapTargets] = useState({});
  const [pendingRemap, setPendingRemap] = useState(null); // { sourceKey, targetKey, users }
  const [remapping, setRemapping] = useState(false);

  useEffect(() => {
    setDefaultRoleDraft(defaultRoleKey || '');
  }, [defaultRoleKey]);

  useEffect(() => {
    if (!roleList.length) {
      setSelectedRole('');
      return;
    }
    if (!selectedRole || !roleList.some((r) => r.key === selectedRole)) {
      setSelectedRole(roleList[0].key);
    }
  }, [roleList, selectedRole]);

  const selectedRoleMeta = useMemo(
    () => roleList.find((r) => r.key === selectedRole) || null,
    [roleList, selectedRole]
  );

  useEffect(() => {
    setDraft(buildDraftFromRole(selectedRoleMeta));
    setFeedbackMsg('');
    setErrorMsg('');
  }, [selectedRoleMeta]);

  const savedSnapshot = useMemo(
    () => (selectedRoleMeta ? serializeRoleDraft(buildDraftFromRole(selectedRoleMeta)) : ''),
    [selectedRoleMeta]
  );
  const draftSnapshot = useMemo(() => serializeRoleDraft(draft), [draft]);
  const isDirty = Boolean(selectedRoleMeta) && savedSnapshot !== draftSnapshot;

  // Detect rank collisions across defined roles
  const rankCollisions = useMemo(() => {
    const map = new Map();
    for (const r of roleList) {
      if (!map.has(r.rank)) map.set(r.rank, []);
      map.get(r.rank).push(r);
    }
    return Array.from(map.entries())
      .filter(([, group]) => group.length > 1)
      .sort((a, b) => b[0] - a[0]);
  }, [roleList]);

  const filteredDefinitions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return PERMISSION_DEFINITIONS.filter((def) => {
      if (category !== 'All' && def.category !== category) return false;
      if (!q) return true;
      return (
        def.key.toLowerCase().includes(q) ||
        def.label.toLowerCase().includes(q) ||
        def.description.toLowerCase().includes(q) ||
        def.category.toLowerCase().includes(q)
      );
    });
  }, [search, category]);

  const reviewApplicantRows = useMemo(() => {
    const rows = roleList.map((r) => ({ key: r.key, label: r.label, rank: r.rank, missing: false }));
    const existingKeys = new Set(rows.map((r) => r.key));
    const configuredKeys = Object.keys(draft.review?.[reviewKind] || {});
    for (const key of configuredKeys) {
      if (!existingKeys.has(key)) {
        rows.push({ key, label: key, rank: 0, missing: true });
      }
    }
    return rows;
  }, [roleList, draft.review, reviewKind]);

  // Can this actor edit the currently selected role under Firestore rules?
  const canModifySelectedRole = useMemo(() => {
    if (!canManageRoles || !selectedRoleMeta) return false;
    if (isBootstrapSuperAdmin) return true;
    return selectedRoleMeta.rank <= callerRank;
  }, [canManageRoles, selectedRoleMeta, isBootstrapSuperAdmin, callerRank]);

  const setRolePermissionScope = (permKey, nextScope) => {
    setFeedbackMsg('');
    setErrorMsg('');
    setDraft((prev) => {
      const nextPerms = { ...(prev.permissions || {}) };
      if (nextScope === 'none') {
        delete nextPerms[permKey];
      } else {
        nextPerms[permKey] = nextScope;
      }
      return { ...prev, permissions: nextPerms };
    });
  };

  const setReviewScope = (applicantKey, nextScope) => {
    setFeedbackMsg('');
    setErrorMsg('');
    setDraft((prev) => {
      const nextReview = {
        leave: { ...(prev.review?.leave || {}) },
        fieldduty: { ...(prev.review?.fieldduty || {}) },
        settle: { ...(prev.review?.settle || {}) }
      };
      if (nextScope === 'none') {
        delete nextReview[reviewKind][applicantKey];
      } else {
        nextReview[reviewKind][applicantKey] = nextScope;
      }
      return { ...prev, review: nextReview };
    });
  };

  const handleToggleSuperOnDraft = (checked) => {
    setFeedbackMsg('');
    setErrorMsg('');
    setDraft((prev) => {
      const nextPerms = { ...(prev.permissions || {}) };
      if (checked) {
        nextPerms['settings.manage'] = 'all';
      }
      return { ...prev, isSuper: checked, permissions: nextPerms };
    });
  };

  const handleSaveRole = async () => {
    if (!selectedRoleMeta || !canManageRoles || !actorUid) {
      setErrorMsg('রোল সংরক্ষণ করার অনুমতি আপনার নেই।');
      return;
    }

    const candidate = {
      ...draft,
      key: selectedRoleMeta.key,
      rank: Number(draft.rank),
      permissions: draft.isSuper
        ? { ...(draft.permissions || {}), 'settings.manage': 'all' }
        : { ...(draft.permissions || {}) }
    };

    const check = validateRoleDefinition(candidate);
    if (!check.valid) {
      setErrorMsg(check.errors.join(' '));
      return;
    }

    if (!isBootstrapSuperAdmin) {
      if (check.normalized.rank > callerRank) {
        setErrorMsg(`আপনার র‍্যাঙ্ক (${callerRank}) এর চেয়ে বেশি র‍্যাঙ্ক দেওয়া যাবে না।`);
        return;
      }
      if (check.normalized.isSuper !== Boolean(selectedRoleMeta.isSuper)) {
        setErrorMsg('শুধুমাত্র বুটস্ট্র্যাপ সুপার অ্যাডমিন Super ফ্ল্যাগ পরিবর্তন করতে পারেন।');
        return;
      }
    }

    setSaving(true);
    setErrorMsg('');
    setFeedbackMsg('');
    try {
      const payload = toFirestoreRolePayload(check.normalized);
      await updateDoc(doc(db, 'roles', check.normalized.key), {
        ...payload,
        updatedAt: serverTimestamp(),
        updatedBy: actorUid
      });

      await logAudit({
        actor: auditActor,
        action: 'ROLE_UPDATED',
        targetCollection: 'roles',
        targetId: check.normalized.key,
        oldValue: savedSnapshot,
        newValue: serializeRoleDraft(check.normalized),
        reason: `Updated role ${check.normalized.key}`
      });

      setFeedbackMsg(`"${check.normalized.label}" রোল সফলভাবে সংরক্ষণ করা হয়েছে।`);
    } catch (err) {
      setErrorMsg('রোল সংরক্ষণ করা যায়নি। অনুগ্রহ করে অনুমোদন ও তথ্য যাচাই করুন।');
      handleFirestoreError(err, OperationType.WRITE, `roles/${check.normalized.key}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    setFeedbackMsg('');
    setErrorMsg('');
    setDraft(buildDraftFromRole(selectedRoleMeta));
  };

  // Default Role Persistence
  const handleSaveDefaultRole = async () => {
    if (!canManageRoles || !actorUid) {
      setErrorMsg('ডিফল্ট রোল পরিবর্তন করার অনুমতি আপনার নেই।');
      return;
    }
    if (defaultRoleDraft && !roleList.some((r) => r.key === defaultRoleDraft)) {
      setErrorMsg('নির্বাচিত ডিফল্ট রোলটি ভূমিকা তালিকায় পাওয়া যায়নি।');
      return;
    }

    setSavingDefaultRole(true);
    setErrorMsg('');
    setFeedbackMsg('');
    try {
      await setDoc(
        doc(db, 'settings', 'app'),
        {
          registrationOpen: Boolean(registrationOpen),
          defaultRole: defaultRoleDraft || '',
          updatedAt: serverTimestamp(),
          updatedBy: actorUid
        },
        { merge: true }
      );

      await logAudit({
        actor: auditActor,
        action: 'DEFAULT_ROLE_CHANGED',
        targetCollection: 'settings',
        targetId: 'app',
        oldValue: defaultRoleKey || '(none)',
        newValue: defaultRoleDraft || '(none)',
        reason: defaultRoleDraft
          ? `Set registration defaultRole to ${defaultRoleDraft}`
          : 'Cleared registration defaultRole'
      });

      setFeedbackMsg(
        defaultRoleDraft
          ? `নিবন্ধনের ডিফল্ট রোল "${defaultRoleDraft}" সংরক্ষণ করা হয়েছে।`
          : 'নিবন্ধনের ডিফল্ট রোল সরানো হয়েছে (নতুন পাবলিক নিবন্ধন বন্ধ থাকবে)।'
      );
    } catch (err) {
      setErrorMsg('ডিফল্ট রোল সংরক্ষণ করা যায়নি।');
      handleFirestoreError(err, OperationType.WRITE, 'settings/app');
    } finally {
      setSavingDefaultRole(false);
    }
  };

  // Create Role
  const openCreateSheet = (prefillKey = '') => {
    const cleanKey = typeof prefillKey === 'string' && prefillKey.trim() !== '__unassigned__' ? prefillKey.trim() : '';
    setCreateDraft({
      ...buildDraftFromRole(null),
      key: cleanKey,
      rank: isBootstrapSuperAdmin ? 20 : Math.max(1, Math.min(20, callerRank))
    });
    setCreateError('');
    setCreateOpen(true);
  };

  const handleCreateRole = async (e) => {
    e.preventDefault();
    if (!canManageRoles || !actorUid) {
      setCreateError('নতুন রোল তৈরি করার অনুমতি আপনার নেই।');
      return;
    }

    const trimmedKey = (createDraft.key || '').trim();
    if (!ROLE_KEY_REGEX.test(trimmedKey)) {
      setCreateError('Role key অবশ্যই ^[a-z][a-z0-9_]{1,39}$ ফরম্যাটে হতে হবে (যেমন: field_supervisor)।');
      return;
    }
    if (roleList.some((r) => r.key === trimmedKey)) {
      setCreateError(`"${trimmedKey}" key-টি ইতিমধ্যেই বিদ্যমান।`);
      return;
    }

    const candidate = {
      ...createDraft,
      key: trimmedKey,
      rank: Number(createDraft.rank),
      permissions: createDraft.isSuper
        ? { ...(createDraft.permissions || {}), 'settings.manage': 'all' }
        : { ...(createDraft.permissions || {}) }
    };

    const check = validateRoleDefinition(candidate);
    if (!check.valid) {
      setCreateError(check.errors.join(' '));
      return;
    }

    if (!isBootstrapSuperAdmin) {
      if (check.normalized.isSuper) {
        setCreateError('শুধুমাত্র বুটস্ট্র্যাপ সুপার অ্যাডমিন নতুন Super রোল তৈরি করতে পারেন।');
        return;
      }
      if (check.normalized.rank > callerRank) {
        setCreateError(`আপনার র‍্যাঙ্ক (${callerRank}) এর চেয়ে বেশি র‍্যাঙ্কের রোল তৈরি করা যাবে না।`);
        return;
      }
    }

    setCreating(true);
    setCreateError('');
    try {
      const payload = toFirestoreRolePayload(check.normalized);
      await setDoc(doc(db, 'roles', check.normalized.key), {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedBy: actorUid
      });

      await logAudit({
        actor: auditActor,
        action: 'ROLE_CREATED',
        targetCollection: 'roles',
        targetId: check.normalized.key,
        oldValue: '',
        newValue: JSON.stringify(payload),
        reason: `Created dynamic role ${check.normalized.key}`
      });

      setCreateOpen(false);
      setSelectedRole(check.normalized.key);
      setFeedbackMsg(`নতুন রোল "${check.normalized.label}" তৈরি করা হয়েছে।`);
      if (hasScannedUnresolved) {
        scanUnresolvedRoles();
      }
    } catch (err) {
      setCreateError('রোল তৈরি করা যায়নি। অনুগ্রহ করে অনুমোদন ও তথ্য পরীক্ষা করুন।');
      handleFirestoreError(err, OperationType.WRITE, `roles/${trimmedKey}`);
    } finally {
      setCreating(false);
    }
  };

  // Delete Role
  const handleRequestDelete = async () => {
    if (!selectedRoleMeta || !canManageRoles) return;
    if (selectedRoleMeta.isSuper && !isBootstrapSuperAdmin) {
      setErrorMsg('শুধুমাত্র বুটস্ট্র্যাপ সুপার অ্যাডমিন Super রোল মুছতে পারেন।');
      return;
    }
    if (defaultRoleKey && defaultRoleKey === selectedRoleMeta.key) {
      setErrorMsg('এই রোলটি বর্তমানে নিবন্ধনের ডিফল্ট রোল হিসেবে নির্ধারিত। মুছতে চাইলে আগে ডিফল্ট রোল পরিবর্তন করুন।');
      return;
    }

    setCheckingDelete(true);
    setErrorMsg('');
    setFeedbackMsg('');
    try {
      const assignedSnap = await getDocs(
        query(collection(db, 'users'), where('role', '==', selectedRoleMeta.key))
      );
      if (assignedSnap.size > 0) {
        setErrorMsg(
          `এই রোলে বর্তমানে ${assignedSnap.size} জন ব্যবহারকারী নিযুক্ত আছেন। মুছতে হলে আগে তাদের রোল পরিবর্তন করুন।`
        );
        return;
      }
      setDeleteConfirmOpen(true);
    } catch (err) {
      setErrorMsg('ব্যবহারকারী সংখ্যা যাচাই করা যায়নি।');
      handleFirestoreError(err, OperationType.LIST, 'users');
    } finally {
      setCheckingDelete(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!selectedRoleMeta || !actorUid) return;
    const roleKey = selectedRoleMeta.key;
    const oldSerialized = serializeRoleDraft(buildDraftFromRole(selectedRoleMeta));

    setDeleting(true);
    setErrorMsg('');
    try {
      await deleteDoc(doc(db, 'roles', roleKey));
      await logAudit({
        actor: auditActor,
        action: 'ROLE_DELETED',
        targetCollection: 'roles',
        targetId: roleKey,
        oldValue: oldSerialized,
        newValue: '',
        reason: `Deleted role ${roleKey}`
      });

      setDeleteConfirmOpen(false);
      setFeedbackMsg(`রোল "${selectedRoleMeta.label}" মুছে ফেলা হয়েছে।`);
    } catch (err) {
      setErrorMsg('রোল মুছে ফেলা যায়নি।');
      handleFirestoreError(err, OperationType.DELETE, `roles/${roleKey}`);
    } finally {
      setDeleting(false);
    }
  };

  // Export JSON
  const handleExportJson = () => {
    const data = exportRoles(roleRegistry);
    const jsonText = `${JSON.stringify(data, null, 2)}\n`;
    const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'roles.export.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  // Import JSON Preview & Commit
  const importAnalysis = useMemo(() => {
    const trimmed = importText.trim();
    if (!trimmed) {
      return { empty: true, valid: false, errors: [], roles: [], toCreate: [], toOverwrite: [], blockedErrors: [] };
    }
    const parsed = parseRolesImport(trimmed);
    const existingMap = roleRegistry || {};
    const toCreate = [];
    const toOverwrite = [];
    const blockedErrors = [];

    if (parsed.valid) {
      for (const r of parsed.roles) {
        const existing = existingMap[r.key];
        if (!isBootstrapSuperAdmin) {
          if (r.rank > callerRank) {
            blockedErrors.push(`${r.key}: rank (${r.rank}) আপনার র‍্যাঙ্ক (${callerRank}) এর চেয়ে বেশি।`);
          }
          if (!existing && r.isSuper) {
            blockedErrors.push(`${r.key}: শুধুমাত্র বুটস্ট্র্যাপ সুপার অ্যাডমিন নতুন Super রোল আমদানি করতে পারেন।`);
          }
          if (existing && r.isSuper !== Boolean(existing.isSuper)) {
            blockedErrors.push(`${r.key}: শুধুমাত্র বুটস্ট্র্যাপ সুপার অ্যাডমিন Super ফ্ল্যাগ পরিবর্তন করতে পারেন।`);
          }
        }
        if (existing) {
          toOverwrite.push(r);
        } else {
          toCreate.push(r);
        }
      }
    }

    return {
      empty: false,
      valid: parsed.valid && blockedErrors.length === 0,
      errors: [...parsed.errors, ...blockedErrors],
      roles: parsed.roles,
      toCreate,
      toOverwrite
    };
  }, [importText, roleRegistry, isBootstrapSuperAdmin, callerRank]);

  const handleImportFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError('');
    try {
      const text = await file.text();
      setImportText(text);
      setImportOverwriteConfirmed(false);
    } catch {
      setImportError('JSON ফাইল পড়া যায়নি।');
    }
    e.target.value = '';
  };

  const handleConfirmImport = async () => {
    if (!canManageRoles || !actorUid) {
      setImportError('রোল আমদানি করার অনুমতি আপনার নেই।');
      return;
    }
    if (!importAnalysis.valid || importAnalysis.roles.length === 0) {
      setImportError('বৈধ JSON রোল তালিকা দিন।');
      return;
    }
    if (importAnalysis.toOverwrite.length > 0 && !importOverwriteConfirmed) {
      setImportError('বিদ্যমান রোল ওভাররাইট করার সম্মতি চেকবক্সে টিক দিন।');
      return;
    }

    setImporting(true);
    setImportError('');
    try {
      const batchSize = 200;
      for (let i = 0; i < importAnalysis.roles.length; i += batchSize) {
        const chunk = importAnalysis.roles.slice(i, i + batchSize);
        const batch = writeBatch(db);
        for (const r of chunk) {
          const ref = doc(db, 'roles', r.key);
          const payload = toFirestoreRolePayload(r);
          if (roleRegistry?.[r.key]) {
            batch.update(ref, {
              ...payload,
              updatedAt: serverTimestamp(),
              updatedBy: actorUid
            });
          } else {
            batch.set(ref, {
              ...payload,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              updatedBy: actorUid
            });
          }
        }
        await batch.commit();
      }

      await logAudit({
        actor: auditActor,
        action: 'ROLES_IMPORTED',
        targetCollection: 'roles',
        targetId: 'batch',
        oldValue: `${roleList.length} existing roles`,
        newValue: JSON.stringify({
          created: importAnalysis.toCreate.map((r) => r.key),
          updated: importAnalysis.toOverwrite.map((r) => r.key)
        }),
        reason: `Imported ${importAnalysis.roles.length} roles from JSON`
      });

      setImportOpen(false);
      setImportText('');
      setImportOverwriteConfirmed(false);
      setFeedbackMsg(
        `সফলভাবে ${importAnalysis.toCreate.length}টি নতুন রোল যোগ এবং ${importAnalysis.toOverwrite.length}টি রোল হালনাগাদ করা হয়েছে।`
      );
      if (hasScannedUnresolved) {
        scanUnresolvedRoles();
      }
    } catch (err) {
      setImportError('রোল আমদানি করতে ব্যর্থ হয়েছে। অনুমোদন ও নিয়ম পরীক্ষা করুন।');
      handleFirestoreError(err, OperationType.WRITE, 'roles');
    } finally {
      setImporting(false);
    }
  };

  // Unresolved Roles Scan & Remap
  const scanUnresolvedRoles = useCallback(async () => {
    if (!canInspectUsers) {
      setUnresolvedError('সকল ব্যবহারকারীর রোল স্ক্যান করতে user.view = all অনুমতি প্রয়োজন।');
      return;
    }
    setScanningUnresolved(true);
    setUnresolvedError('');
    try {
      const snap = await getDocs(collection(db, 'users'));
      const groupsMap = new Map();
      snap.forEach((docSnap) => {
        const data = docSnap.data() || {};
        const rawRole = typeof data.role === 'string' ? data.role.trim() : '';
        if (!rawRole) {
          if (data.isBootstrapSuper === true) return;
          const bucketKey = '__unassigned__';
          if (!groupsMap.has(bucketKey)) {
            groupsMap.set(bucketKey, {
              key: bucketKey,
              isEmptyRole: true,
              label: 'রোল নির্ধারিত নেই (empty)',
              users: []
            });
          }
          groupsMap.get(bucketKey).users.push({
            uid: docSnap.id,
            name: data.name || data.email || docSnap.id,
            email: data.email || ''
          });
          return;
        }
        if (!roleRegistry || !Object.prototype.hasOwnProperty.call(roleRegistry, rawRole)) {
          if (!groupsMap.has(rawRole)) {
            groupsMap.set(rawRole, {
              key: rawRole,
              isEmptyRole: false,
              label: rawRole,
              users: []
            });
          }
          groupsMap.get(rawRole).users.push({
            uid: docSnap.id,
            name: data.name || data.email || docSnap.id,
            email: data.email || ''
          });
        }
      });

      const list = Array.from(groupsMap.values()).sort((a, b) => b.users.length - a.users.length);
      setUnresolvedGroups(list);
      setHasScannedUnresolved(true);
    } catch (err) {
      setUnresolvedError('অমীমাংসিত রোল স্ক্যান করা যায়নি।');
      handleFirestoreError(err, OperationType.LIST, 'users');
    } finally {
      setScanningUnresolved(false);
    }
  }, [canInspectUsers, roleRegistry]);

  useEffect(() => {
    if (canInspectUsers) {
      scanUnresolvedRoles();
    }
  }, [canInspectUsers, scanUnresolvedRoles]);

  const handleRequestRemap = (group) => {
    const targetKey = remapTargets[group.key] || '';
    if (!targetKey || !roleRegistry?.[targetKey]) {
      setUnresolvedError('প্রথমে একটি বৈধ গন্তব্য রোল নির্বাচন করুন।');
      return;
    }
    if (!canRemapUsers) {
      setUnresolvedError('ব্যাচ রোল পুনর্নির্ধারণের জন্য সুপার ব্যবহারকারী এবং user.role.assign = all অনুমতি প্রয়োজন।');
      return;
    }
    setUnresolvedError('');
    setPendingRemap({
      sourceKey: group.key,
      sourceLabel: group.isEmptyRole ? '(unassigned)' : group.key,
      targetKey,
      targetLabel: roleRegistry[targetKey]?.label || targetKey,
      users: group.users
    });
  };

  const handleConfirmRemap = async () => {
    if (!pendingRemap || !canRemapUsers) return;
    setRemapping(true);
    setUnresolvedError('');
    try {
      // Chunk batches at 10 users so Firestore rules per-batch get()/exists() stays safely under 20
      const CHUNK_SIZE = 10;
      const usersToUpdate = pendingRemap.users;
      for (let i = 0; i < usersToUpdate.length; i += CHUNK_SIZE) {
        const chunk = usersToUpdate.slice(i, i + CHUNK_SIZE);
        const batch = writeBatch(db);
        for (const u of chunk) {
          batch.update(doc(db, 'users', u.uid), {
            role: pendingRemap.targetKey,
            updatedAt: serverTimestamp()
          });
        }
        await batch.commit();
      }

      await logAudit({
        actor: auditActor,
        action: 'ROLES_REMAPPED',
        targetCollection: 'users',
        targetId: pendingRemap.sourceLabel,
        oldValue: `${pendingRemap.sourceLabel} (${usersToUpdate.length} users)`,
        newValue: pendingRemap.targetKey,
        reason: `Remapped ${usersToUpdate.length} users from ${pendingRemap.sourceLabel} to ${pendingRemap.targetKey}`
      });

      setFeedbackMsg(
        `${usersToUpdate.length} জন ব্যবহারকারীকে "${pendingRemap.sourceLabel}" থেকে "${pendingRemap.targetLabel}" রোলে সরানো হয়েছে।`
      );
      setPendingRemap(null);
      await scanUnresolvedRoles();
    } catch (err) {
      setUnresolvedError('ব্যবহারকারীদের রোল পরিবর্তন করা যায়নি। অনুমতি ও অনুমোদন অবস্থা পরীক্ষা করুন।');
      handleFirestoreError(err, OperationType.WRITE, 'users');
    } finally {
      setRemapping(false);
    }
  };

  const activePermCount = useMemo(
    () => Object.values(draft.permissions || {}).filter((s) => s && s !== 'none').length,
    [draft.permissions]
  );

  const selectedCanDelete =
    Boolean(selectedRoleMeta) &&
    canManageRoles &&
    (!selectedRoleMeta.isSuper || isBootstrapSuperAdmin);

  return (
    <AppShell title="Role Manager" showThemeToggle>
      <div className="space-y-5 pb-12">
        {/* Header Bar */}
        <section className="rounded-[20px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 sm:p-5 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 font-display flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-[#0b6b4f] dark:text-[#4fd1a1] shrink-0" />
              <span>Dynamic Role Manager</span>
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              রোল তৈরি, সম্পাদনা, অনুমোদন-চেইন (<code className="font-mono-tabular">review</code>), ডিফল্ট নিবন্ধন রোল ও JSON আমদানি/রপ্তানি এখান থেকে পরিচালিত হয় ({roles.length}টি রোল লোড হয়েছে)।
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={!canManageRoles}
              onClick={() => openCreateSheet('')}
              className="min-h-[44px] px-4 py-2 rounded-[14px] bg-[#0b6b4f] hover:bg-[#09553f] dark:bg-[#4fd1a1] dark:hover:bg-[#3fc090] text-white dark:text-slate-950 text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>নতুন রোল তৈরি</span>
            </button>
            <button
              type="button"
              disabled={!canManageRoles}
              onClick={() => {
                setImportError('');
                setImportOverwriteConfirmed(false);
                setImportOpen(true);
              }}
              className="min-h-[44px] px-3.5 py-2 rounded-[14px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <Upload className="w-4 h-4" />
              <span>JSON আমদানি</span>
            </button>
            <button
              type="button"
              disabled={roleList.length === 0}
              onClick={handleExportJson}
              className="min-h-[44px] px-3.5 py-2 rounded-[14px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              <span>JSON রপ্তানি</span>
            </button>
          </div>
        </section>

        {!canManageRoles && (
          <div className="p-3.5 rounded-[14px] bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-200">
            শুধুমাত্র অনুমোদিত সুপার প্রশাসক (<code className="font-mono-tabular">settings.manage</code>) রোল পরিবর্তন করতে পারেন।
          </div>
        )}

        {/* Rank Collision Warning */}
        {rankCollisions.length > 0 && (
          <div className="p-3.5 rounded-[16px] bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">র‍্যাঙ্ক সংঘাত সতর্কতা (Rank Collision)</p>
              <p className="mt-0.5">
                একাধিক রোলের র‍্যাঙ্ক সমান হলে একজন রোল অন্যটিকে অনুমোদন বা এডিট করতে পারবে না:{' '}
                {rankCollisions
                  .map(([rk, grp]) => `Rank ${rk} (${grp.map((g) => g.label).join(', ')})`)
                  .join(' · ')}
              </p>
            </div>
          </div>
        )}

        {/* Default Registration Role Control */}
        <section className="rounded-[20px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 sm:p-5 space-y-3">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 font-display">
                পাবলিক নিবন্ধনের ডিফল্ট রোল (Default Role)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                স্বয়ং-নিবন্ধিত (<code className="font-mono-tabular">/register</code>) নতুন ব্যবহারকারীরা কোন রোল পাবে তা এখান থেকে নির্ধারণ করুন।
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0">
              <select
                aria-label="Registration default role"
                disabled={!canManageRoles || savingDefaultRole}
                value={defaultRoleDraft}
                onChange={(e) => setDefaultRoleDraft(e.target.value)}
                className="min-h-[44px] sm:min-w-[240px] px-3.5 py-2 rounded-[14px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-base sm:text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#0b6b4f] dark:focus:ring-[#4fd1a1]"
              >
                <option value="">নির্ধারিত নয় (পাবলিক নিবন্ধন বন্ধ)</option>
                {roleList.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label} ({r.key} · Rank {r.rank})
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!canManageRoles || savingDefaultRole || defaultRoleDraft === (defaultRoleKey || '')}
                onClick={handleSaveDefaultRole}
                className="min-h-[44px] px-4 py-2 rounded-[14px] bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold hover:bg-slate-800 dark:hover:bg-white disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{savingDefaultRole ? 'সংরক্ষণ হচ্ছে...' : 'ডিফল্ট সংরক্ষণ'}</span>
              </button>
            </div>
          </div>

          {registrationOpen && !defaultRoleKey && (
            <div className="p-3 rounded-[12px] bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-200 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>
                নিবন্ধন চালু আছে কিন্তু কোনো ডিফল্ট রোল নির্ধারিত নেই — ডিফল্ট রোল সেট না করা পর্যন্ত পাবলিক নিবন্ধন বন্ধ থাকবে।
              </span>
            </div>
          )}
        </section>

        {feedbackMsg && (
          <div className="p-3.5 rounded-[14px] bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-200">
            {feedbackMsg}
          </div>
        )}
        {errorMsg && (
          <div className="p-3.5 rounded-[14px] bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-xs text-rose-800 dark:text-rose-200">
            {errorMsg}
          </div>
        )}

        {/* Empty State or Main Editor */}
        {roleList.length === 0 ? (
          <section className="rounded-[20px] bg-white dark:bg-slate-900 border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center space-y-4">
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 font-display">
              কোনো রোল তৈরি করা হয়নি
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-lg mx-auto leading-relaxed">
              সিস্টেমে এখনো কোনো রোল নেই। নতুন রোল তৈরি করুন অথবা <code className="font-mono-tabular">JSON</code> ফাইল থেকে রোল আমদানি করুন।
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                disabled={!canManageRoles}
                onClick={() => openCreateSheet('')}
                className="min-h-[44px] px-4 py-2 rounded-[14px] bg-[#0b6b4f] hover:bg-[#09553f] dark:bg-[#4fd1a1] dark:hover:bg-[#3fc090] text-white dark:text-slate-950 text-xs font-semibold inline-flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>নতুন রোল তৈরি</span>
              </button>
              <button
                type="button"
                disabled={!canManageRoles}
                onClick={() => {
                  setImportError('');
                  setImportOverwriteConfirmed(false);
                  setImportOpen(true);
                }}
                className="min-h-[44px] px-4 py-2 rounded-[14px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 text-xs font-semibold inline-flex items-center gap-1.5"
              >
                <Upload className="w-4 h-4" />
                <span>JSON থেকে রোল আমদানি</span>
              </button>
            </div>
          </section>
        ) : (
          <>
            {/* Role Cards Selector */}
            <section aria-label="Select role to configure" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {roleList.map((role) => {
                const active = selectedRole === role.key;
                const permCount = Object.values(role.permissions || {}).filter((s) => s && s !== 'none').length;
                const isDefault = defaultRoleKey === role.key;
                return (
                  <button
                    key={role.key}
                    type="button"
                    onClick={() => setSelectedRole(role.key)}
                    className={`min-h-[44px] text-left rounded-[16px] border p-3.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1] ${
                      active
                        ? 'bg-[#0b6b4f]/10 dark:bg-[#4fd1a1]/15 border-[#0b6b4f] dark:border-[#4fd1a1]'
                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/70'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`text-sm font-bold truncate ${
                          active ? 'text-[#0b6b4f] dark:text-[#4fd1a1]' : 'text-slate-900 dark:text-slate-100'
                        }`}
                      >
                        {role.label}
                      </span>
                      <span className="text-[11px] font-mono-tabular px-2 py-0.5 rounded-[8px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 shrink-0">
                        Rank {role.rank}
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center justify-between gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-mono-tabular truncate">
                        {role.key} · {permCount} perms
                      </span>
                      <div className="flex items-center gap-1">
                        {isDefault && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-[6px] bg-sky-100 dark:bg-sky-900/40 text-sky-800 dark:text-sky-300">
                            Default
                          </span>
                        )}
                        {role.isSuper && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-[6px] bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300">
                            Super
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </section>

            {/* Dirty Warning Banner */}
            {isDirty && (
              <div className="p-3.5 rounded-[16px] bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs font-medium text-amber-900 dark:text-amber-200">
                  &ldquo;{selectedRoleMeta?.label}&rdquo; রোলের পরিবর্তন এখনো সংরক্ষণ করা হয়নি।
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleDiscard}
                    disabled={saving}
                    className="min-h-[44px] px-3.5 py-1.5 rounded-[12px] border border-amber-300 dark:border-amber-700 text-xs font-semibold text-amber-900 dark:text-amber-200 hover:bg-amber-100/70 dark:hover:bg-amber-900/40"
                  >
                    Discard
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveRole}
                    disabled={saving || !canModifySelectedRole}
                    className="min-h-[44px] px-4 py-1.5 rounded-[12px] bg-[#0b6b4f] text-white text-xs font-semibold hover:bg-[#09553f] disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </div>
            )}

            {/* Selected Role Workspace */}
            {selectedRoleMeta && (
              <section className="rounded-[20px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
                {/* Workspace Header */}
                <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display">
                        {draft.label || selectedRoleMeta.label}
                      </h2>
                      <code className="text-[11px] font-mono-tabular px-2 py-0.5 rounded-[8px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                        {selectedRoleMeta.key}
                      </code>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
                      Rank {draft.rank} · {activePermCount} permissions · Home: {draft.homeRoute || 'Auto'}
                      {draft.chargeEligible ? ' · Charge-eligible' : ''}
                      {draft.actingEligible ? ' · Acting-eligible' : ''}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {selectedCanDelete && (
                      <button
                        type="button"
                        disabled={checkingDelete || saving}
                        onClick={handleRequestDelete}
                        className="min-h-[44px] px-3.5 py-2 rounded-[14px] border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <Trash2 className="w-4 h-4" />
                        <span>{checkingDelete ? 'Checking...' : 'রোল মুছুন'}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={!isDirty || saving || !canModifySelectedRole}
                      onClick={handleSaveRole}
                      className="min-h-[44px] px-4 py-2 rounded-[14px] bg-[#0b6b4f] hover:bg-[#09553f] dark:bg-[#4fd1a1] dark:hover:bg-[#3fc090] text-white dark:text-slate-950 text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 transition-colors"
                    >
                      <Save className="w-4 h-4" />
                      <span>{saving ? 'Saving...' : 'Save Role'}</span>
                    </button>
                  </div>
                </div>

                {!canModifySelectedRole && canManageRoles && (
                  <div className="mx-4 mt-4 p-3 rounded-[12px] bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-200">
                    আপনার র‍্যাঙ্ক ({callerRank}) এই রোলের র‍্যাঙ্ক ({selectedRoleMeta.rank}) এর চেয়ে কম হওয়ায় শুধুমাত্র বুটস্ট্র্যাপ সুপার অ্যাডমিন এটি পরিবর্তন করতে পারবেন।
                  </div>
                )}

                {/* Workspace Sub-tabs */}
                <div className="px-4 sm:px-5 pt-3 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-2">
                  {[
                    { id: 'permissions', label: `Permissions (${activePermCount})` },
                    { id: 'review', label: 'Approval Chain (review)' },
                    { id: 'meta', label: 'Role Details & Flags' }
                  ].map((tab) => {
                    const active = workspaceTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setWorkspaceTab(tab.id)}
                        className={`min-h-[44px] px-4 py-2 text-xs font-semibold border-b-2 transition-colors ${
                          active
                            ? 'border-[#0b6b4f] dark:border-[#4fd1a1] text-[#0b6b4f] dark:text-[#4fd1a1]'
                            : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                        }`}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>

                {/* Tab 1: Permissions */}
                {workspaceTab === 'permissions' && (
                  <div>
                    <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 space-y-3">
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                        <div className="relative md:max-w-md w-full">
                          <Search
                            aria-hidden="true"
                            className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                          />
                          <input
                            type="search"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search permission by name or key..."
                            className="w-full min-h-[44px] pl-10 pr-10 py-2 rounded-[14px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-base sm:text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#0b6b4f] dark:focus:ring-[#4fd1a1]"
                          />
                          {search && (
                            <button
                              type="button"
                              onClick={() => setSearch('')}
                              aria-label="Clear search"
                              className="min-h-[44px] min-w-[44px] absolute right-0 top-1/2 -translate-y-1/2 inline-flex items-center justify-center text-slate-400"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                        <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                          Showing {filteredDefinitions.length} of {PERMISSION_DEFINITIONS.length}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {CATEGORIES.map((cat) => {
                          const active = category === cat;
                          return (
                            <button
                              key={cat}
                              type="button"
                              onClick={() => setCategory(cat)}
                              className={`min-h-[44px] px-3.5 py-2 rounded-[14px] border text-xs font-semibold transition-colors ${
                                active
                                  ? 'bg-[#0b6b4f] dark:bg-[#4fd1a1] text-white dark:text-slate-950 border-[#0b6b4f] dark:border-[#4fd1a1]'
                                  : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
                              }`}
                            >
                              {cat}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                      {filteredDefinitions.length === 0 ? (
                        <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
                          কোনো পারমিশন খুঁজে পাওয়া যায়নি।
                        </div>
                      ) : (
                        filteredDefinitions.map((def) => {
                          const currentScope = draft.permissions?.[def.key] || 'none';
                          const isLocked = Boolean(draft.isSuper && def.lockedForSuperRole);

                          return (
                            <div
                              key={def.key}
                              className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                            >
                              <div className="space-y-1 min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm font-bold text-slate-900 dark:text-slate-100">{def.label}</span>
                                  <code className="text-[11px] font-mono-tabular px-2 py-0.5 rounded-[8px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                                    {def.key}
                                  </code>
                                  <span className="text-[11px] px-2 py-0.5 rounded-[8px] bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                                    {def.category}
                                  </span>
                                </div>
                                <p className="text-xs text-slate-500 dark:text-slate-400">{def.description}</p>
                              </div>

                              <div className="flex flex-wrap items-center gap-2 shrink-0">
                                {isLocked ? (
                                  <div className="min-h-[44px] px-3.5 py-2 rounded-[14px] bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs font-semibold text-[#0b6b4f] dark:text-[#4fd1a1] inline-flex items-center gap-1.5">
                                    <Lock className="w-3.5 h-3.5" />
                                    <span>Always All (Locked)</span>
                                  </div>
                                ) : (
                                  <div
                                    role="group"
                                    aria-label={`${def.label} scope for ${selectedRoleMeta.label}`}
                                    className="inline-flex flex-wrap items-center gap-1 p-1 rounded-[14px] bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700"
                                  >
                                    {def.allowedScopes.map((scopeVal) => {
                                      const selected = currentScope === scopeVal;
                                      const isDeniedChoice = scopeVal === 'none';
                                      return (
                                        <button
                                          key={scopeVal}
                                          type="button"
                                          disabled={!canModifySelectedRole || saving}
                                          aria-pressed={selected}
                                          onClick={() => setRolePermissionScope(def.key, scopeVal)}
                                          className={`min-h-[44px] px-3 py-1.5 rounded-[10px] text-xs font-semibold transition-colors disabled:opacity-60 ${
                                            selected
                                              ? isDeniedChoice
                                                ? 'bg-rose-700 text-white shadow-xs'
                                                : 'bg-[#0b6b4f] dark:bg-[#4fd1a1] text-white dark:text-slate-950 shadow-xs'
                                              : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                                          }`}
                                        >
                                          {SCOPE_LABELS[scopeVal]}
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}

                {/* Tab 2: Approval Chain Editor */}
                {workspaceTab === 'review' && (
                  <div className="p-4 sm:p-5 space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        নির্ধারণ করুন <span className="font-semibold text-slate-800 dark:text-slate-200">{draft.label}</span> কোন কোন আবেদনকারী রোলের আবেদন অনুমোদন/প্রত্যাখ্যান/নিষ্পত্তি করতে পারবে (শুধুমাত্র এই ম্যাট্রিক্স অনুযায়ী রিভিউ ক্ষমতা প্রযোজ্য)।
                      </p>
                      <div className="inline-flex flex-wrap items-center gap-1 p-1 rounded-[14px] bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 shrink-0">
                        {REVIEW_KINDS.map((kind) => {
                          const active = reviewKind === kind;
                          return (
                            <button
                              key={kind}
                              type="button"
                              onClick={() => setReviewKind(kind)}
                              className={`min-h-[44px] px-3 py-1.5 rounded-[10px] text-xs font-semibold transition-colors ${
                                active
                                  ? 'bg-[#0b6b4f] dark:bg-[#4fd1a1] text-white dark:text-slate-950'
                                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                              }`}
                            >
                              {REVIEW_KIND_LABELS[kind]}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="rounded-[16px] border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
                      {reviewApplicantRows.map((targetRole) => {
                        const currentScope = draft.review?.[reviewKind]?.[targetRole.key] || 'none';
                        return (
                          <div
                            key={targetRole.key}
                            className="p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                          >
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                                  {targetRole.label}
                                </span>
                                <code className="text-[11px] font-mono-tabular px-2 py-0.5 rounded-[8px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                                  {targetRole.key}
                                </code>
                                {targetRole.missing ? (
                                  <span className="text-[11px] px-2 py-0.5 rounded-[8px] bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300">
                                    Unresolved role key
                                  </span>
                                ) : (
                                  <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                                    Rank {targetRole.rank}
                                  </span>
                                )}
                              </div>
                            </div>

                            <div
                              role="group"
                              aria-label={`${REVIEW_KIND_LABELS[reviewKind]} scope for applicant ${targetRole.label}`}
                              className="inline-flex flex-wrap items-center gap-1 p-1 rounded-[14px] bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 shrink-0"
                            >
                              {['none', ...REVIEW_SCOPES].map((scopeVal) => {
                                const selected = currentScope === scopeVal;
                                return (
                                  <button
                                    key={scopeVal}
                                    type="button"
                                    disabled={!canModifySelectedRole || saving}
                                    aria-pressed={selected}
                                    onClick={() => setReviewScope(targetRole.key, scopeVal)}
                                    className={`min-h-[44px] px-3 py-1.5 rounded-[10px] text-xs font-semibold transition-colors disabled:opacity-60 ${
                                      selected
                                        ? scopeVal === 'none'
                                          ? 'bg-slate-700 dark:bg-slate-600 text-white'
                                          : 'bg-[#0b6b4f] dark:bg-[#4fd1a1] text-white dark:text-slate-950'
                                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                                    }`}
                                  >
                                    {REVIEW_SCOPE_LABELS[scopeVal]}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Tab 3: Role Metadata & Flags */}
                {workspaceTab === 'meta' && (
                  <div className="p-4 sm:p-5 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                          Role Key (অপরিবর্তনীয়)
                        </label>
                        <input
                          type="text"
                          value={draft.key}
                          readOnly
                          disabled
                          className="w-full min-h-[44px] px-3.5 py-2 rounded-[14px] border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800/70 text-base sm:text-sm font-mono-tabular text-slate-600 dark:text-slate-400"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                          Display Label (2–80 chars)
                        </label>
                        <input
                          type="text"
                          maxLength={80}
                          disabled={!canModifySelectedRole || saving}
                          value={draft.label}
                          onChange={(e) => {
                            setFeedbackMsg('');
                            setErrorMsg('');
                            setDraft((prev) => ({ ...prev, label: e.target.value }));
                          }}
                          className="w-full min-h-[44px] px-3.5 py-2 rounded-[14px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-base sm:text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#0b6b4f] dark:focus:ring-[#4fd1a1]"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                          Hierarchy Rank (1–100 integer)
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={isBootstrapSuperAdmin ? 100 : callerRank}
                          step={1}
                          disabled={!canModifySelectedRole || saving}
                          value={draft.rank}
                          onChange={(e) => {
                            setFeedbackMsg('');
                            setErrorMsg('');
                            setDraft((prev) => ({
                              ...prev,
                              rank: e.target.value === '' ? '' : Number.parseInt(e.target.value, 10)
                            }));
                          }}
                          className="w-full min-h-[44px] px-3.5 py-2 rounded-[14px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-base sm:text-sm font-mono-tabular text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#0b6b4f] dark:focus:ring-[#4fd1a1]"
                        />
                        {!isBootstrapSuperAdmin && (
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                            সর্বোচ্চ অনুমোদিত র‍্যাঙ্ক: {callerRank}
                          </p>
                        )}
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                          Home Route
                        </label>
                        <select
                          disabled={!canModifySelectedRole || saving}
                          value={draft.homeRoute || ''}
                          onChange={(e) => {
                            setFeedbackMsg('');
                            setErrorMsg('');
                            setDraft((prev) => ({ ...prev, homeRoute: e.target.value }));
                          }}
                          className="w-full min-h-[44px] px-3.5 py-2 rounded-[14px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-base sm:text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#0b6b4f] dark:focus:ring-[#4fd1a1]"
                        >
                          {['', ...HOME_ROUTES].map((rt) => (
                            <option key={rt || 'auto'} value={rt}>
                              {HOME_ROUTE_LABELS[rt] || rt}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                        Description (optional, max 300 chars)
                      </label>
                      <textarea
                        rows={2}
                        maxLength={300}
                        disabled={!canModifySelectedRole || saving}
                        value={draft.description}
                        onChange={(e) => {
                          setFeedbackMsg('');
                          setErrorMsg('');
                          setDraft((prev) => ({ ...prev, description: e.target.value }));
                        }}
                        className="w-full px-3.5 py-2.5 rounded-[14px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-base sm:text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#0b6b4f] dark:focus:ring-[#4fd1a1]"
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
                      <label className="min-h-[44px] flex items-start gap-3 p-3.5 rounded-[14px] border border-slate-200 dark:border-slate-800 cursor-pointer">
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4 accent-[#0b6b4f]"
                          disabled={!canModifySelectedRole || saving}
                          checked={Boolean(draft.chargeEligible)}
                          onChange={(e) => {
                            setFeedbackMsg('');
                            setDraft((prev) => ({ ...prev, chargeEligible: e.target.checked }));
                          }}
                        />
                        <div className="text-xs">
                          <div className="font-semibold text-slate-900 dark:text-slate-100">Charge-eligible</div>
                          <div className="text-slate-500 dark:text-slate-400">
                            অতিরিক্ত দায়িত্ব বা সংযুক্তি (<code className="font-mono-tabular">additionalOfficeIds</code> / <code className="font-mono-tabular">attachedOfficeId</code>) দেওয়া যাবে।
                          </div>
                        </div>
                      </label>

                      <label className="min-h-[44px] flex items-start gap-3 p-3.5 rounded-[14px] border border-slate-200 dark:border-slate-800 cursor-pointer">
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4 accent-[#0b6b4f]"
                          disabled={!canModifySelectedRole || saving}
                          checked={Boolean(draft.actingEligible)}
                          onChange={(e) => {
                            setFeedbackMsg('');
                            setDraft((prev) => ({ ...prev, actingEligible: e.target.checked }));
                          }}
                        />
                        <div className="text-xs">
                          <div className="font-semibold text-slate-900 dark:text-slate-100">Acting-eligible</div>
                          <div className="text-slate-500 dark:text-slate-400">
                            অন্য কর্মীকে <code className="font-mono-tabular">actingRoleKey</code> হিসেবে এই রোলটি অর্পণ করা যাবে।
                          </div>
                        </div>
                      </label>

                      <label
                        className={`min-h-[44px] flex items-start gap-3 p-3.5 rounded-[14px] border border-slate-200 dark:border-slate-800 ${
                          isBootstrapSuperAdmin ? 'cursor-pointer' : 'opacity-70 cursor-not-allowed'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4 accent-[#0b6b4f]"
                          disabled={!isBootstrapSuperAdmin || saving}
                          checked={Boolean(draft.isSuper)}
                          onChange={(e) => handleToggleSuperOnDraft(e.target.checked)}
                        />
                        <div className="text-xs">
                          <div className="font-semibold text-slate-900 dark:text-slate-100">Super Role (isSuper)</div>
                          <div className="text-slate-500 dark:text-slate-400">
                            {isBootstrapSuperAdmin
                              ? 'সিস্টেম-স্তরের র‍্যাঙ্ক ও রোল ব্যবস্থাপনা; settings.manage = All লক থাকে।'
                              : 'শুধুমাত্র বুটস্ট্র্যাপ সুপার অ্যাডমিন পরিবর্তন করতে পারেন।'}
                          </div>
                        </div>
                      </label>
                    </div>
                  </div>
                )}
              </section>
            )}
          </>
        )}

        {/* Unresolved Roles Panel ("অমীমাংসিত রোল") */}
        <section className="rounded-[20px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 sm:p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display flex items-center gap-2">
                <ArrowRightLeft className="w-4 h-4 text-[#0b6b4f] dark:text-[#4fd1a1]" />
                <span>অমীমাংসিত রোল (Unresolved Roles)</span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                ব্যবহারকারীর প্রোফাইলে এমন কোনো <code className="font-mono-tabular">role</code> মান থাকলে যা বর্তমানে সংজ্ঞায়িত নয়, এখান থেকে নতুন রোল তৈরি বা অন্য রোলে সরানো যাবে।
              </p>
            </div>
            <button
              type="button"
              disabled={!canInspectUsers || scanningUnresolved}
              onClick={scanUnresolvedRoles}
              className="min-h-[44px] px-3.5 py-2 rounded-[14px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5 disabled:opacity-50 shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${scanningUnresolved ? 'animate-spin' : ''}`} />
              <span>{scanningUnresolved ? 'স্ক্যান হচ্ছে...' : 'পুনরায় স্ক্যান করুন'}</span>
            </button>
          </div>

          {unresolvedError && (
            <div className="p-3 rounded-[12px] bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-xs text-rose-800 dark:text-rose-200">
              {unresolvedError}
            </div>
          )}

          {!canInspectUsers ? (
            <div className="text-xs text-slate-500 dark:text-slate-400">
              অমীমাংসিত রোল স্ক্যান করতে <code className="font-mono-tabular">user.view = all</code> প্রয়োজন।
            </div>
          ) : !hasScannedUnresolved && scanningUnresolved ? (
            <div className="text-xs text-slate-500 dark:text-slate-400">ব্যবহারকারী তালিকা পরীক্ষা করা হচ্ছে...</div>
          ) : unresolvedGroups.length === 0 ? (
            <div className="p-4 rounded-[14px] bg-slate-50 dark:bg-slate-800/50 text-xs text-slate-600 dark:text-slate-300">
              কোনো অমীমাংসিত রোল পাওয়া যায়নি। সব ব্যবহারকারীর রোল বৈধ।
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 rounded-[16px] border border-slate-200 dark:border-slate-800">
              {unresolvedGroups.map((group) => {
                const selectedTarget = remapTargets[group.key] || '';
                const sampleNames = group.users
                  .slice(0, 4)
                  .map((u) => u.name)
                  .join(', ');
                const extraCount = Math.max(0, group.users.length - 4);
                return (
                  <div
                    key={group.key}
                    className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="text-xs font-mono-tabular px-2 py-0.5 rounded-[8px] bg-amber-100 dark:bg-amber-900/40 text-amber-900 dark:text-amber-200 font-semibold">
                          {group.isEmptyRole ? '(unassigned)' : group.key}
                        </code>
                        <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                          {group.users.length} জন ব্যবহারকারী
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                        উদাহরণ: {sampleNames}
                        {extraCount > 0 ? ` (+${extraCount} জন)` : ''}
                      </p>
                    </div>

                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0">
                      {!group.isEmptyRole && ROLE_KEY_REGEX.test(group.key) && canManageRoles && (
                        <button
                          type="button"
                          onClick={() => openCreateSheet(group.key)}
                          className="min-h-[44px] px-3.5 py-2 rounded-[14px] border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
                        >
                          এই key দিয়ে রোল তৈরি করুন
                        </button>
                      )}

                      {roleList.length > 0 && (
                        <div className="flex items-center gap-2">
                          <select
                            aria-label={`Target role for ${group.key}`}
                            disabled={!canRemapUsers || remapping}
                            value={selectedTarget}
                            onChange={(e) =>
                              setRemapTargets((prev) => ({ ...prev, [group.key]: e.target.value }))
                            }
                            className="min-h-[44px] px-3 py-2 rounded-[14px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-base sm:text-xs text-slate-900 dark:text-slate-100"
                          >
                            <option value="">নতুন রোল নির্বাচন...</option>
                            {roleList.map((r) => (
                              <option key={r.key} value={r.key}>
                                {r.label} ({r.key})
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            disabled={!canRemapUsers || !selectedTarget || remapping}
                            onClick={() => handleRequestRemap(group)}
                            className="min-h-[44px] px-3.5 py-2 rounded-[14px] bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold hover:bg-slate-800 dark:hover:bg-white disabled:opacity-50 whitespace-nowrap"
                          >
                            অন্য রোলে সরান
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Create Role BottomSheet */}
      <BottomSheet
        open={createOpen}
        onClose={() => !creating && setCreateOpen(false)}
        title="নতুন রোল তৈরি করুন"
        subtitle="রোল key, লেবেল, র‍্যাঙ্ক ও প্রারম্ভিক বৈশিষ্ট্য নির্ধারণ করুন"
        maxWidthClass="sm:max-w-lg"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={creating}
              onClick={() => setCreateOpen(false)}
              className="min-h-[44px] px-4 py-2 rounded-[14px] border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200"
            >
              বাতিল
            </button>
            <button
              type="submit"
              form="create-role-form"
              disabled={creating}
              className="min-h-[44px] px-5 py-2 rounded-[14px] bg-[#0b6b4f] hover:bg-[#09553f] dark:bg-[#4fd1a1] dark:hover:bg-[#3fc090] text-white dark:text-slate-950 text-xs font-semibold disabled:opacity-50"
            >
              {creating ? 'তৈরি হচ্ছে...' : 'রোল তৈরি করুন'}
            </button>
          </div>
        }
      >
        <form id="create-role-form" onSubmit={handleCreateRole} className="space-y-4">
          {createError && (
            <div className="p-3 rounded-[12px] bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-xs text-rose-800 dark:text-rose-200">
              {createError}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              Role Key * (lowercase snake_case, 2–40 chars)
            </label>
            <input
              type="text"
              required
              placeholder="e.g. zonal_supervisor"
              value={createDraft.key}
              onChange={(e) => setCreateDraft((prev) => ({ ...prev, key: e.target.value.toLowerCase() }))}
              className="w-full min-h-[44px] px-3.5 py-2 rounded-[14px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-base sm:text-sm font-mono-tabular text-slate-900 dark:text-slate-100"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              Display Label * (2–80 chars)
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Zonal Supervisor"
              value={createDraft.label}
              onChange={(e) => setCreateDraft((prev) => ({ ...prev, label: e.target.value }))}
              className="w-full min-h-[44px] px-3.5 py-2 rounded-[14px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-base sm:text-sm text-slate-900 dark:text-slate-100"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Hierarchy Rank * (1–{isBootstrapSuperAdmin ? 100 : callerRank})
              </label>
              <input
                type="number"
                required
                min={1}
                max={isBootstrapSuperAdmin ? 100 : callerRank}
                step={1}
                value={createDraft.rank}
                onChange={(e) =>
                  setCreateDraft((prev) => ({
                    ...prev,
                    rank: e.target.value === '' ? '' : Number.parseInt(e.target.value, 10)
                  }))
                }
                className="w-full min-h-[44px] px-3.5 py-2 rounded-[14px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-base sm:text-sm font-mono-tabular text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Home Route
              </label>
              <select
                value={createDraft.homeRoute || ''}
                onChange={(e) => setCreateDraft((prev) => ({ ...prev, homeRoute: e.target.value }))}
                className="w-full min-h-[44px] px-3 py-2 rounded-[14px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-base sm:text-sm text-slate-900 dark:text-slate-100"
              >
                {['', ...HOME_ROUTES].map((rt) => (
                  <option key={rt || 'auto'} value={rt}>
                    {HOME_ROUTE_LABELS[rt] || rt}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              Description (optional)
            </label>
            <textarea
              rows={2}
              maxLength={300}
              value={createDraft.description}
              onChange={(e) => setCreateDraft((prev) => ({ ...prev, description: e.target.value }))}
              className="w-full px-3.5 py-2 rounded-[14px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-base sm:text-sm text-slate-900 dark:text-slate-100"
            />
          </div>

          <div className="space-y-2">
            <label className="min-h-[44px] flex items-center gap-2.5 text-xs font-medium text-slate-800 dark:text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[#0b6b4f]"
                checked={Boolean(createDraft.chargeEligible)}
                onChange={(e) => setCreateDraft((prev) => ({ ...prev, chargeEligible: e.target.checked }))}
              />
              <span>Charge-eligible (অতিরিক্ত দায়িত্ব/সংযুক্তি নিতে পারবে)</span>
            </label>

            <label className="min-h-[44px] flex items-center gap-2.5 text-xs font-medium text-slate-800 dark:text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[#0b6b4f]"
                checked={Boolean(createDraft.actingEligible)}
                onChange={(e) => setCreateDraft((prev) => ({ ...prev, actingEligible: e.target.checked }))}
              />
              <span>Acting-eligible (ভারপ্রাপ্ত দায়িত্ব হিসেবে দেওয়া যাবে)</span>
            </label>

            {isBootstrapSuperAdmin && (
              <label className="min-h-[44px] flex items-center gap-2.5 text-xs font-medium text-slate-800 dark:text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[#0b6b4f]"
                  checked={Boolean(createDraft.isSuper)}
                  onChange={(e) =>
                    setCreateDraft((prev) => ({
                      ...prev,
                      isSuper: e.target.checked,
                      permissions: e.target.checked
                        ? { ...(prev.permissions || {}), 'settings.manage': 'all' }
                        : prev.permissions
                    }))
                  }
                />
                <span>Super Role (isSuper; settings.manage = All লক থাকবে)</span>
              </label>
            )}
          </div>
        </form>
      </BottomSheet>

      {/* JSON Import BottomSheet */}
      <BottomSheet
        open={importOpen}
        onClose={() => !importing && setImportOpen(false)}
        title="JSON থেকে রোল আমদানি"
        subtitle="বৈধ JSON অ্যারে আপলোড বা পেস্ট করুন — সংরক্ষণের আগে পার্থক্য যাচাই হবে"
        maxWidthClass="sm:max-w-2xl"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={importing}
              onClick={() => setImportOpen(false)}
              className="min-h-[44px] px-4 py-2 rounded-[14px] border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200"
            >
              বাতিল
            </button>
            <button
              type="button"
              disabled={
                importing ||
                !importAnalysis.valid ||
                importAnalysis.roles.length === 0 ||
                (importAnalysis.toOverwrite.length > 0 && !importOverwriteConfirmed)
              }
              onClick={handleConfirmImport}
              className="min-h-[44px] px-5 py-2 rounded-[14px] bg-[#0b6b4f] hover:bg-[#09553f] dark:bg-[#4fd1a1] dark:hover:bg-[#3fc090] text-white dark:text-slate-950 text-xs font-semibold disabled:opacity-50"
            >
              {importing ? 'আমদানি হচ্ছে...' : `আমদানি নিশ্চিত করুন (${importAnalysis.roles.length})`}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          {importError && (
            <div className="p-3 rounded-[12px] bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-xs text-rose-800 dark:text-rose-200">
              {importError}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="min-h-[44px] px-3.5 py-2 rounded-[14px] border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-2 cursor-pointer">
              <Upload className="w-4 h-4" />
              <span>.json ফাইল নির্বাচন করুন</span>
              <input type="file" accept=".json,application/json" onChange={handleImportFileChange} className="hidden" />
            </label>
            {importText && (
              <button
                type="button"
                onClick={() => {
                  setImportText('');
                  setImportOverwriteConfirmed(false);
                }}
                className="min-h-[44px] px-3 py-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              >
                পরিষ্কার করুন
              </button>
            )}
          </div>

          <textarea
            rows={8}
            value={importText}
            onChange={(e) => {
              setImportText(e.target.value);
              setImportOverwriteConfirmed(false);
              setImportError('');
            }}
            placeholder='[{"key":"example_role","label":"Example Role","rank":20,"isSuper":false,"chargeEligible":false,"actingEligible":false,"permissions":{"user.view":"office"},"review":{}}]'
            className="w-full p-3.5 rounded-[14px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono-tabular text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#0b6b4f] dark:focus:ring-[#4fd1a1]"
          />

          {!importAnalysis.empty && importAnalysis.errors.length > 0 && (
            <div className="p-3.5 rounded-[14px] bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 space-y-1 text-xs text-rose-800 dark:text-rose-200">
              <div className="font-semibold">ভ্যালিডেশন ত্রুটি পাওয়া গেছে:</div>
              <ul className="list-disc pl-5 space-y-0.5 max-h-40 overflow-y-auto">
                {importAnalysis.errors.slice(0, 15).map((err, idx) => (
                  <li key={idx}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          {!importAnalysis.empty && importAnalysis.valid && (
            <div className="p-3.5 rounded-[14px] bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-3 text-xs">
              <div className="font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                প্রিভিউ: {importAnalysis.toCreate.length}টি নতুন তৈরি · {importAnalysis.toOverwrite.length}টি বিদ্যমান ওভাররাইট
              </div>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {importAnalysis.roles.map((r) => {
                  const exists = Boolean(roleRegistry?.[r.key]);
                  return (
                    <div key={r.key} className="flex items-center justify-between gap-2 py-1 border-b border-slate-200/70 dark:border-slate-700/70 last:border-b-0">
                      <span className="truncate font-medium text-slate-800 dark:text-slate-200">
                        {r.label} <code className="font-mono-tabular text-slate-500">({r.key})</code>
                      </span>
                      <span
                        className={`text-[11px] font-semibold px-2 py-0.5 rounded-[6px] shrink-0 ${
                          exists
                            ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300'
                            : 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300'
                        }`}
                      >
                        {exists ? 'Overwrite' : 'Create'}
                      </span>
                    </div>
                  );
                })}
              </div>

              {importAnalysis.toOverwrite.length > 0 && (
                <label className="min-h-[44px] flex items-start gap-2.5 pt-1 text-xs font-medium text-amber-900 dark:text-amber-200 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 accent-[#0b6b4f]"
                    checked={importOverwriteConfirmed}
                    onChange={(e) => setImportOverwriteConfirmed(e.target.checked)}
                  />
                  <span>
                    আমি নিশ্চিত যে বিদ্যমান {importAnalysis.toOverwrite.length}টি রোলের সংজ্ঞা নতুন JSON দ্বারা প্রতিস্থাপিত হবে।
                  </span>
                </label>
              )}
            </div>
          )}
        </div>
      </BottomSheet>

      {/* Delete Role Confirmation */}
      <ConfirmSheet
        open={deleteConfirmOpen}
        danger
        title="রোল স্থায়ীভাবে মুছুন"
        message={
          selectedRoleMeta
            ? `আপনি কি নিশ্চিত যে "${selectedRoleMeta.label}" (${selectedRoleMeta.key}) রোলটি মুছে ফেলতে চান?`
            : ''
        }
        confirmLabel={deleting ? 'মুছে ফেলা হচ্ছে...' : 'মুছে ফেলুন'}
        cancelLabel="বাতিল"
        onConfirm={handleConfirmDelete}
        onCancel={() => !deleting && setDeleteConfirmOpen(false)}
      />

      {/* Batch Remap Confirmation */}
      <ConfirmSheet
        open={Boolean(pendingRemap)}
        title="ব্যবহারকারীদের রোল পরিবর্তন নিশ্চিত করুন"
        message={
          pendingRemap
            ? `${pendingRemap.users.length} জন ব্যবহারকারীকে "${pendingRemap.sourceLabel}" থেকে "${pendingRemap.targetLabel}" (${pendingRemap.targetKey}) রোলে স্থানান্তর করা হবে। এগিয়ে যেতে চান?`
            : ''
        }
        confirmLabel={remapping ? 'স্থানান্তর হচ্ছে...' : 'স্থানান্তর নিশ্চিত করুন'}
        cancelLabel="বাতিল"
        onConfirm={handleConfirmRemap}
        onCancel={() => !remapping && setPendingRemap(null)}
      />
    </AppShell>
  );
}
