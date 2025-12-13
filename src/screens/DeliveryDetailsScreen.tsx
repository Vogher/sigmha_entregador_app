import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  Linking,
  Alert,
  Modal,
  TextInput,
  Image,
  Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import Signature from 'react-native-signature-canvas';
import { api } from '../services/api';
import { useAuth } from '@/context/AuthProvider';
import { RouteProp, useRoute, useNavigation } from '@react-navigation/native';

// >>> store de rascunhos (vida do app)
import { getDraft, setDraft, clearDraft } from '@/states/deliveryDrafts';

type RootParamList = {
  DeliveryDetails: {
    entrega: Partial<Entrega> | { id: number };
  };
};

type Entrega = {
  id: number;

  // ORIGEM
  cliente_nome?: string | null;
  coleta_endereco?: string | null;
  coleta_cep?: string | null;
  coleta_complemento?: string | null;
  coleta_observacoes?: string | null;

  // DESTINO
  entrega_destinatario?: string | null; // (compat)
  entrega_endereco?: string | null;
  entrega_cep?: string | null;
  entrega_telefone?: string | null;
  entrega_complemento?: string | null;
  entrega_observacoes?: string | null;

  // RECEBEDOR
  recebedor_nome?: string | null;

  // CONTROLE
  status?: string | null;
  has_retorno?: boolean | null;

  // Assinatura obrigatória?
  comprovante_assinado?: boolean | null;
};

const PICKER_OPTS = {
  allowsEditing: false,
  quality: 0.6,
  mediaTypes: ImagePicker.MediaTypeOptions.Images,
} as const;

type TabKey = 'ORIGEM' | 'DESTINO' | 'RETORNO' | 'MAIS';

type Stage = 'coletar' | 'entregar' | 'retornar' | 'finalizar';

const GOLD = '#D4AF37';
const BG = '#000';
const TEXT_GOLD = GOLD;
const TAB_BG = '#000';

// ————————————————————————— helpers —————————————————————————
function canonicalizeAddress(raw?: string | null): string {
  if (!raw) return '';
  let s = String(raw).trim();
  s = s
    .replace(/[—–−]+/g, '-')
    .replace(/[•·]+/g, '-')
    .replace(/\s*-\s*/g, ' - ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();

  const parts = s
    .split(/(?:,|-)/g)
    .map(t => t.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const dedup: string[] = [];
  for (const part of parts) {
    const key = part.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push(part);
  }

  if (dedup.length === 0) return '';
  if (dedup.length >= 2) {
    const head = `${dedup[0]}, ${dedup[1]}`;
    const tail = dedup.slice(2).join(' - ');
    return tail ? `${head} - ${tail}` : head;
  }
  return dedup.join(' - ');
}

// Rascunho salvo localmente (store do app)
type Draft = {
  photos?: string[];
  description?: string;
  receiverName?: string;
  receiverLocked?: boolean;
  photoLocked?: boolean;
  signatureLocked?: boolean; // NOVO
};

function toBool(v: any): boolean {
  if (typeof v === 'boolean') return v;
  if (v === null || v === undefined) return false;
  const s = String(v).trim().toLowerCase();
  if (['1', 'true', 't', 'yes', 'y', 'sim', 's'].includes(s)) return true;
  if (['0', 'false', 'f', 'no', 'n', 'nao', 'não'].includes(s)) return false;
  if (!Number.isNaN(Number(s))) return Number(s) !== 0;
  return false;
}

// normaliza status vindo do backend
function normStatus(s?: any): string {
  const t = String(s ?? '').trim().toLowerCase();
  if (!t) return 'novo';
  if (t === 'await' || t === 'waiting' || t === 'pendente') return 'novo';
  if (t === 'iniciado') return 'iniciado';
  if (t === 'coletando') return 'coletando';
  if (t === 'entregando') return 'entregando';
  if (t === 'retornando') return 'retornando';
  if (t === 'finalizado') return 'finalizado';
  if (t === 'cancelado') return 'cancelado';
  return t;
}

// converte status do backend para estágio do botão
function statusToStage(status: any, hasRetorno: boolean): Stage {
  const s = normStatus(status);
  if (s === 'coletando') return 'entregar';
  if (s === 'entregando') return hasRetorno ? 'retornar' : 'finalizar';
  if (s === 'retornando') return 'finalizar';
  if (s === 'finalizado' || s === 'cancelado') return 'finalizar';
  // "novo" ou "iniciado" ou qualquer outro
  return 'coletar';
}

function labelFromStage(s: Stage): string {
  if (s === 'coletar') return 'Coletar';
  if (s === 'entregar') return 'Entregar';
  if (s === 'retornar') return 'Retornar';
  return 'Finalizar entrega';
}

// Helpers de upload (RN/Expo)
function inferMimeFromUri(uri: string) {
  const lower = uri.split('?')[0].toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.heic') || lower.endsWith('.heif')) return 'image/jpeg';
  return 'image/jpeg';
}
function ensureFileUri(uri: string) {
  if (!uri) return uri as any;
  if (Platform.OS === 'ios' && !uri.startsWith('file://')) return `file://${uri}`;
  return uri;
}
const API_BASE = ((api as any)?.defaults?.baseURL || '').replace(/\/+$/, '');

// ————————————————————————— screen —————————————————————————
export default function DeliveryDetailsScreen() {
  const route = useRoute<RouteProp<RootParamList, 'DeliveryDetails'>>();
  const initialEntrega = (route.params?.entrega || {}) as Partial<Entrega>;
  const navigation = useNavigation<any>();

  const [tab, setTab] = useState<TabKey>('ORIGEM');
  const [entrega, setEntrega] = useState<Partial<Entrega>>({
    ...initialEntrega,
    comprovante_assinado: toBool(
      (initialEntrega as any)?.comprovante_assinado ??
      (initialEntrega as any)?.comprovanteAssinado
    ),
  });

  const { user } = useAuth();
  const motoboyId = user?.id;

  // Modal: nome do recebedor
  const [isReceiverModalVisible, setReceiverModalVisible] = useState(false);
  const [receiverName, setReceiverName] = useState('');

  // Modal: fotos
  const [isPhotoModalVisible, setPhotoModalVisible] = useState(false);
  const [takenPhotos, setTakenPhotos] = useState<string[]>([]);
  const [photoDescription, setPhotoDescription] = useState('');

  // Modal: assinatura
  const [isSignatureModalVisible, setSignatureModalVisible] = useState(false);
  const [receiverNameForSign, setReceiverNameForSign] = useState('');
  const signatureRef = useRef<any>(null);

  // Locks
  const [receiverLocked, setReceiverLocked] = useState(false);
  const [photoLocked, setPhotoLocked] = useState(false);
  const [signatureLocked, setSignatureLocked] = useState(false);

  // Hold do botão de status (1,5s)
  const [showHoldError, setShowHoldError] = useState(false);
  const [holdLoading, setHoldLoading] = useState(false);
  const holdDoneRef = useRef(false);

  const { height } = useWindowDimensions();
  const headerTopOffset = Math.min(160, Math.max(56, Math.round(height * 0.12)));
  const contentTopPad = Math.min(180, Math.max(36, Math.round(height * 0.10)));
  const contentBottomPad = Math.min(140, Math.max(28, Math.round(height * 0.08)));

  // —————————————————— Carrega/atualiza entrega do backend ——————————————————
  useEffect(() => {
    const id = initialEntrega.id;
    if (!id) return;
    let cancelled = false;

    (async () => {
      try {
        let res = await api.get(`/api/entregas-pendentes/${id}`);
        let data = res?.data;
        if (!data || (Array.isArray(data) && data.length === 0)) {
          const res2 = await api.get(`/api/entregas-pendentes`, { params: { id } });
          data = res2?.data;
        }
        let full: any = data ?? {};
        if (Array.isArray(full)) full = full[0] ?? {};
        if (full && typeof full === 'object' && Array.isArray(full.rows)) full = full.rows[0] ?? {};

        if (!cancelled) {
          // DEBUG extra
          console.log('[DETAILS][FETCH] {id}', { id },
            { keys: Object.keys(full || {}) },
            { rawFlag: full?.comprovante_assinado ?? full?.comprovanteAssinado }
          );

          setEntrega(prev => {
            const normalized: any = { ...full };

            const rawFlag = normalized.comprovante_assinado ?? normalized.comprovanteAssinado;

            const finalFlag =
              rawFlag === undefined
                ? toBool(prev?.comprovante_assinado ?? (prev as any)?.comprovanteAssinado)
                : toBool(rawFlag);

            const hasAssinaturaSalva =
              Boolean(normalized.assinatura_url || normalized.assinatura_coletada_at);

            if (hasAssinaturaSalva) {
              setSignatureLocked(true);
            }

            const next = {
              ...prev,
              ...normalized,
              comprovante_assinado: finalFlag,
            };

            console.log('[DETAILS][FETCH][MERGED]', {
              entregaId: next.id,
              finalFlag,
              status: next.status,
              hasAssinaturaSalva,
            });

            return next;
          });
        }
      } catch (e) {
        console.warn('[DETAILS] fetch erro', e);
      }
    })();

    return () => { cancelled = true; };
  }, [initialEntrega.id]);

  const entregaId = entrega.id ?? initialEntrega.id ?? 0;

  // —— flags derivados do payload do backend ——
  // retorno: **apenas** pelo campo has_retorno (conforme pedido)
  const hasRetorno = toBool((entrega as any)?.has_retorno);

  // assinatura obrigatória: usar o mesmo flag que vem do back
  const signatureRequired = React.useMemo(() => {
    const raw =
      entrega?.comprovante_assinado ??
      (entrega as any)?.comprovanteAssinado;
    return toBool(raw);
  }, [entrega?.comprovante_assinado, (entrega as any)?.comprovanteAssinado]);

  const effectiveStatus = normStatus(entrega?.status);
  const isConcluded =
    effectiveStatus === 'finalizado' || effectiveStatus === 'cancelado';

  const currentStage: Stage = useMemo(
    () => statusToStage(entrega?.status, hasRetorno),
    [entrega?.status, hasRetorno]
  );

  // ——— Log de verificação central
  useEffect(() => {
    const raw =
      entrega?.comprovante_assinado ??
      (entrega as any)?.comprovanteAssinado;

    const needsSignature = toBool(raw);

    console.log('[DETAILS][CHECK]',
      {
        entregaId,
        status: entrega?.status,
        rawFlag: raw,
        needsSignature,
        receiverLocked,
        signatureLocked,
        hasAssinaturaSalva: Boolean(
          (entrega as any)?.assinatura_url || (entrega as any)?.assinatura_coletada_at
        )
      }
    );
  }, [
    entregaId,
    entrega?.status,
    entrega?.comprovante_assinado,
    (entrega as any)?.comprovanteAssinado,
    receiverLocked,
    signatureLocked
  ]);

  // Hidrata rascunho salvo (fotos, descrição, recebedor, locks) ao entrar
  useEffect(() => {
    if (!entregaId) return;

    const draft = (getDraft(entregaId) || {}) as Draft;

    setTakenPhotos(draft.photos ?? []);
    setPhotoDescription(draft.description ?? '');

    const hasReceiverBackend =
      !!(entrega.recebedor_nome && String(entrega.recebedor_nome).trim());

    const draftReceiverLocked = draft.receiverLocked ?? false;
    const draftPhotoLocked = draft.photoLocked ?? false;
    const draftSignatureLocked = draft.signatureLocked ?? false;

    if (draft.receiverName) {
      setEntrega(prev => ({ ...prev, recebedor_nome: draft.receiverName }));
    }

    setReceiverLocked(draftReceiverLocked || hasReceiverBackend);
    setPhotoLocked(Boolean(draftPhotoLocked));
    setSignatureLocked(Boolean(draftSignatureLocked));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entregaId]);

  // Sincroniza mudanças para o store (vida do app)
  useEffect(() => {
    if (!entregaId) return;
    setDraft(entregaId, {
      photos: takenPhotos,
      description: photoDescription,
      receiverName: entrega.recebedor_nome ?? '',
      receiverLocked,
      photoLocked,
      signatureLocked,
    } as Draft);
  }, [
    entregaId,
    takenPhotos,
    photoDescription,
    entrega.recebedor_nome,
    receiverLocked,
    photoLocked,
    signatureLocked,
  ]);

  // —————————————————— RECEBEDOR ——————————————————
  const handleOpenReceiverModal = () => {
    setReceiverName(entrega.recebedor_nome ?? '');
    setReceiverModalVisible(true);
  };

  const handleSaveReceiver = async () => {
    const trimmed = (receiverName || '').trim();
    setEntrega(prev => ({ ...prev, recebedor_nome: trimmed }));

    try {
      await api.post(`/api/entregas-pendentes/${entregaId}/recebedor`, {
        recebedor_nome: trimmed
      }).catch(async (err: any) => {
        if (err?.response?.status === 404 || err?.response?.status === 501) {
          await api.post(`/entregas-pendentes/${entregaId}/recebedor`, {
            recebedor_nome: trimmed
          });
        } else {
          throw err;
        }
      });

      if (trimmed.length > 0) setReceiverLocked(true);
      setReceiverModalVisible(false);
    } catch (e) {
      console.warn('[DETAILS] salvar recebedor erro', e);
      Alert.alert('Erro', 'Não consegui salvar o recebedor no servidor.');
    }
  };

  // —————————————————— FOTOS ——————————————————
  async function ensureCameraPermission(): Promise<boolean> {
    const cam = await ImagePicker.requestCameraPermissionsAsync();
    if (cam.status !== 'granted') {
      Alert.alert('Permissão necessária', 'Conceda acesso à câmera para continuar.');
      return false;
    }
    if (Platform.OS === 'android') {
      await ImagePicker.requestMediaLibraryPermissionsAsync();
    }
    return true;
  }

  const handleTakePhoto = async () => {
    if (photoLocked) return;
    const ok = await ensureCameraPermission();
    if (!ok) return;

    const result = await ImagePicker.launchCameraAsync(PICKER_OPTS);
    if (result.canceled) return;

    const newUri = result.assets?.[0]?.uri;
    if (!newUri) return;

    setTakenPhotos(prev => [...prev, newUri]);
    setPhotoModalVisible(true);
  };

  const handleAddPhotoInsideModal = async () => {
    const ok = await ensureCameraPermission();
    if (!ok) return;

    const result = await ImagePicker.launchCameraAsync(PICKER_OPTS);
    if (result.canceled) return;

    const newUri = result.assets?.[0]?.uri;
    if (newUri) setTakenPhotos(prev => [...prev, newUri]);
  };

  const handleRemovePhoto = (uriToRemove: string) => {
    setTakenPhotos(prev => prev.filter(u => u !== uriToRemove));
  };

  async function uploadEntregaPhotos(entregaId: number, uris: string[]) {
    if (!API_BASE) throw new Error('API baseURL ausente. Defina api.defaults.baseURL no serviço.');
    const results: Array<{ ok: boolean; uri: string; error?: string }> = [];
    for (const raw of uris) {
      const uri = ensureFileUri(raw);
      const name = `foto_${Date.now()}.jpg`;
      const type = inferMimeFromUri(uri);

      const fd = new FormData();
      fd.append('file', { uri, name, type } as any);

      try {
        const res = await fetch(`${API_BASE}/api/entregas-pendentes/${entregaId}/fotos`, {
          method: 'POST',
          body: fd,
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          results.push({ ok: false, uri, error: j?.error || `HTTP ${res.status}` });
        } else {
          results.push({ ok: true, uri });
        }
      } catch (err: any) {
        results.push({ ok: false, uri, error: String(err?.message || err) });
      }
    }
    return results;
  }

  const handleSavePhoto = async () => {
    if (takenPhotos.length === 0) {
      setPhotoLocked(false);
      setPhotoModalVisible(false);
      return;
    }
    try {
      const results = await uploadEntregaPhotos(entregaId, takenPhotos);
      const fails = results.filter(r => !r.ok);
      if (fails.length > 0) {
        console.warn('[DETAILS] upload falhou em:', fails);
        Alert.alert('Erro', 'Algumas fotos não foram enviadas. Tente novamente.');
        return;
      }
      setPhotoLocked(true);
      setPhotoModalVisible(false);
      setTakenPhotos([]);
      setDraft(entregaId, {
        ...((getDraft(entregaId) || {}) as Draft),
        photos: [],
        photoLocked: true,
      } as Draft);
    } catch (e) {
      console.warn('[DETAILS] upload erro', e);
      Alert.alert('Erro', 'Não consegui enviar as fotos. Tente novamente.');
    }
  };

  // —————————————————— ASSINATURA ——————————————————
  async function uploadEntregaSignature(entregaId: number, dataUrl: string) {
    if (!API_BASE) throw new Error('API baseURL ausente.');

    console.log('[UPLOAD_DEBUG] Starting upload', { entregaId, API_BASE });

    const fd = new FormData();
    fd.append('file', {
      // @ts-ignore
      uri: dataUrl,
      name: 'assinatura.png',
      type: 'image/png',
    });

    const tryOnce = async (url: string) => {
      console.log('[UPLOAD_DEBUG] Trying URL:', url);
      try {
        const res = await fetch(url, {
            method: 'POST',
            body: fd,
            headers: {
                'Accept': 'application/json',
            }
        });
        console.log('[UPLOAD_DEBUG] Response status:', res.status);
        
        const text = await res.text();
        console.log('[UPLOAD_DEBUG] Response body:', text);

        if (!res.ok) {
            let errorMsg = `HTTP ${res.status}`;
            try {
                const j = JSON.parse(text);
                if (j?.error) errorMsg = j.error;
            } catch (e) {}
            throw new Error(errorMsg);
        }
        return JSON.parse(text);
      } catch (err) {
          console.log('[UPLOAD_DEBUG] Fetch error:', err);
          throw err;
      }
    };

    try {
      return await tryOnce(`${API_BASE}/api/entregas-pendentes/${entregaId}/assinatura`);
    } catch (e: any) {
      console.log('[UPLOAD_DEBUG] First attempt failed, trying fallback...');
      // fallback sem /api
      return await tryOnce(`${API_BASE}/entregas-pendentes/${entregaId}/assinatura`);
    }
  }

  const openSignatureModal = () => {
    if (signatureLocked) return;
    setReceiverNameForSign(entrega.recebedor_nome ?? '');
    setSignatureModalVisible(true);
  };

  const handleSignatureOK = async (pngDataUrl: string) => {
    try {
      await uploadEntregaSignature(entregaId, pngDataUrl);

      const trimmed = (receiverNameForSign || '').trim();
      if (trimmed) {
        await api.post(`/api/entregas-pendentes/${entregaId}/recebedor`, {
          recebedor_nome: trimmed,
        }).catch(async (err: any) => {
          if (err?.response?.status === 404 || err?.response?.status === 501) {
            await api.post(`/entregas-pendentes/${entregaId}/recebedor`, { recebedor_nome: trimmed });
          } else { throw err; }
        });
        setEntrega(prev => ({ ...prev, recebedor_nome: trimmed }));
      }

      setSignatureLocked(true);
      setSignatureModalVisible(false);
      setDraft(entregaId, {
        ...((getDraft(entregaId) || {}) as Draft),
        signatureLocked: true,
      } as Draft);
    } catch (e) {
      console.warn('[DETAILS] assinatura erro', e);
      Alert.alert('Erro', 'Não consegui salvar a assinatura. Tente novamente.');
    }
  };

  const handleClearSignature = () => {
    signatureRef.current?.clearSignature?.();
  };
  const handleSaveSignaturePress = () => {
    signatureRef.current?.readSignature?.();
  };

  // —————————————————— MAPAS ——————————————————
  const openGoogleMapsDirection = async () => {
    const origin = canonicalizeAddress(entrega.coleta_endereco);
    const destination = canonicalizeAddress(entrega.entrega_endereco);
    if (!origin || !destination) {
      Alert.alert('Endereços insuficientes', 'Preciso de origem e destino para abrir a rota.');
      return;
    }

    const url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}`;
    try {
      await Linking.openURL(url);
    } catch (err) {
      console.warn('[DETAILS] open maps erro', err);
      Alert.alert('Erro', 'Não consegui abrir o Google Maps neste dispositivo.');
    }
  };

  // —————————————————— STATUS: helpers de backend ——————————————————
  async function updateEntregaStatus(entregaId: number, newStatus: string): Promise<boolean> {
    const urls = [
      `/api/entregas-pendentes/${entregaId}/status`,
      `/entregas-pendentes/${entregaId}/status`,
    ];
    for (const u of urls) {
      try {
        const r = await api.put(u, { status: newStatus });
        if (r?.status >= 200 && r?.status < 300) return true;
      } catch { }
    }
    return false;
  }

  async function finalizarEntrega(entregaId: number, motoboyId: number): Promise<boolean> {
    const urls = [
      `/api/entregas-pendentes/${entregaId}/finalizar`,
      `/entregas-pendentes/${entregaId}/finalizar`,
    ];
    for (const u of urls) {
      try {
        const r = await api.post(u, { motoboy_id: motoboyId });
        if (r.status === 204 || (r.status >= 200 && r.status < 300)) return true;
      } catch { }
    }
    return false;
  }

  /** Check media on backend - returns whether photos and signature exist */
  async function checkMediaOnBackend(entregaId: number): Promise<{ has_photos: boolean; has_signature: boolean }> {
    const urls = [
      `/api/entregas-pendentes/${entregaId}/check-media`,
      `/entregas-pendentes/${entregaId}/check-media`,
    ];
    for (const u of urls) {
      try {
        console.log('[DETAILS] Checking media at:', u);
        const r = await api.get(u);
        if (r?.data) {
          console.log('[DETAILS] Media check response:', r.data);
          return r.data;
        }
      } catch (e) {
        console.log('[DETAILS] Media check failed:', (e as any)?.message);
      }
    }
    console.log('[DETAILS] ⚠️ Could not check media on backend, assuming missing');
    return { has_photos: false, has_signature: false };
  }

  // —————————————————— UI helpers ——————————————————
  const Field = ({ label, value, always }: { label: string; value?: string | null; always?: boolean; }) => {
    const show = always || (value !== undefined && value !== null && String(value).trim().length > 0);
    if (!show) return null;
    return (
      <View style={styles.fieldRow}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <Text style={styles.fieldValue}>{value ?? ''}</Text>
      </View>
    );
  };

  const MapBanner = () => (
    <View style={styles.mapBanner}>
      <View style={styles.mapBannerTextWrap}>
        <Text style={styles.mapBannerTitle}>Quer ver a rota?</Text>
        <Text style={styles.mapBannerSubtitle}>Toque no ícone para ver a rota completa.</Text>
      </View>
      <TouchableOpacity onPress={openGoogleMapsDirection} style={styles.mapBannerIconBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
        <MaterialIcons name="location-on" size={28} color={GOLD} />
      </TouchableOpacity>
    </View>
  );

  // === Lógica de hold do botão de status (1.5s) ===
  const handleStatusHoldSuccess = async () => {
  if (!entregaId) return;
  if (isConcluded) return;

  holdDoneRef.current = true;
  setHoldLoading(true);

  try {
    const stage = currentStage;

    if (stage === 'finalizar') {
      if (!motoboyId) {
        Alert.alert('Erro', 'Motoboy não identificado para finalizar a entrega.');
        return;
      }

      // Validação: Se requer assinatura, deve ter assinatura E fotos
      const requiresSignature = toBool(entrega?.comprovante_assinado);
      console.log('[DETAILS] Finalizar pressed - entregaId:', entregaId);
      console.log('[DETAILS] Requires signature?', requiresSignature);
      
      if (requiresSignature) {
        console.log('[DETAILS] Checking media on backend...');
        const mediaCheck = await checkMediaOnBackend(entregaId);
        console.log('[DETAILS] Backend media check:', mediaCheck);
        
        if (!mediaCheck.has_signature) {
          console.log('[DETAILS] ❌ BLOCKING - No signature on backend');
          Alert.alert('Assinatura necessária', 'Esta entrega requer assinatura do cliente. Colha a assinatura antes de finalizar.');
          setSignatureModalVisible(true);
          return;
        }

        if (!mediaCheck.has_photos) {
          console.log('[DETAILS] ❌ BLOCKING - No photos on backend');
          Alert.alert('Fotos necessárias', 'Esta entrega requer pelo menos uma foto. Tire uma foto antes de finalizar.');
          setPhotoModalVisible(true);
          return;
        }
        
        console.log('[DETAILS] ✅ All media found on backend - proceeding with finalization');
      } else {
        console.log('[DETAILS] ✅ No signature required - proceeding with finalization');
      }

      const ok = await finalizarEntrega(entregaId, motoboyId as number);
      if (!ok) {
        Alert.alert('Falha', 'Não foi possível finalizar a entrega no servidor.');
        return;
      }

      // Atualiza status local
      setEntrega(prev => ({ ...prev, status: 'Finalizado' }));

      // Mostra alerta e volta pro Home
      Alert.alert(
        'Finalizado',
        'Entrega finalizada com sucesso.',
        [
          {
            text: 'OK',
            onPress: () => {
              navigation.goBack(); // volta pra tela anterior (Home)
            },
          },
        ],
        { cancelable: false }
      );

      return;
    }

    let newStatus = 'Coletando';
    if (stage === 'entregar') newStatus = 'Entregando';
    else if (stage === 'retornar') newStatus = 'Retornando';

    const ok = await updateEntregaStatus(entregaId, newStatus);
    if (!ok) {
      Alert.alert('Falha', 'Não foi possível atualizar o status no servidor.');
      return;
    }

    setEntrega(prev => ({ ...prev, status: newStatus }));
  } finally {
    setHoldLoading(false);
  }
};


  const handleStatusHoldRelease = () => {
    if (holdDoneRef.current) {
      holdDoneRef.current = false;
      return;
    }
    setShowHoldError(true);
  };

  const StatusButton = () => {
    const label = isConcluded
      ? 'Entrega finalizada'
      : labelFromStage(currentStage);

    return (
      <TouchableOpacity
        style={[
          styles.statusBtn,
          {
            backgroundColor: GOLD,
            borderColor: '#000',
          },
          (holdLoading || isConcluded) && { opacity: 0.7 },
        ]}
        activeOpacity={0.8}
        disabled={holdLoading || isConcluded || !entregaId}
        onLongPress={handleStatusHoldSuccess}
        delayLongPress={1500} // 1,5s
        onPressOut={handleStatusHoldRelease}
      >
        <Text style={[styles.statusBtnText, { color: '#000' }]}>
          {label}
        </Text>
      </TouchableOpacity>
    );
  };

  const ActionButtons = () => {
    const st = (entrega.status ?? '').toString().toLowerCase();
    const allowed = ['coletando', 'entregando', 'retornando'];
    const canAct = allowed.includes(st);
    if (!canAct) return null;

    const needsSignature = React.useMemo(() => {
      const raw =
        entrega.comprovante_assinado ??
        (entrega as any).comprovanteAssinado;
      const val = toBool(raw);
      console.log('[DETAILS][UI] render ActionButtons', {
        entregaId,
        status: entrega?.status,
        rawFlag: raw,
        needsSignature: val,
        receiverLocked,
        signatureLocked
      });
      return val;
    }, [
      entrega?.status,
      entrega?.comprovante_assinado,
      (entrega as any)?.comprovanteAssinado,
      receiverLocked,
      signatureLocked,
      entregaId
    ]);

    const receiverLabel = receiverLocked ? 'Recebedor Informado!' : 'Informar Recebedor';
    const photoLabel = photoLocked ? 'Foto enviada!' : 'Enviar Foto';
    const signLabel = signatureLocked ? 'Assinatura Coletada!' : 'Coletar Assinatura';

    return (
      <View style={styles.actionButtonsContainer}>
        {/* Botão 1: assinatura OU recebedor */}
        {needsSignature ? (
          <TouchableOpacity
            style={[
              styles.actionButton,
              signatureLocked && styles.actionButtonDisabled,
              signatureLocked && { backgroundColor: '#0b0b0b' }
            ]}
            onPress={signatureLocked ? undefined : openSignatureModal}
            activeOpacity={signatureLocked ? 1 : 0.8}
            disabled={signatureLocked}
          >
            <Text style={[styles.actionButtonText, signatureLocked && styles.actionButtonTextDisabled]}>
              {signLabel}
            </Text>
            <MaterialIcons
              name={signatureLocked ? 'check-circle' : 'gesture'}
              size={20}
              color={signatureLocked ? GOLD : '#000'}
            />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.actionButton, (receiverLocked) && styles.actionButtonDisabled]}
            onPress={receiverLocked ? undefined : handleOpenReceiverModal}
            activeOpacity={receiverLocked ? 1 : 0.8}
            disabled={receiverLocked}
          >
            <Text style={[styles.actionButtonText, (receiverLocked) && styles.actionButtonTextDisabled]}>
              {receiverLabel}
            </Text>
            <MaterialIcons
              name={receiverLocked ? 'check-circle' : 'edit'}
              size={20}
              color={receiverLocked ? GOLD : '#000'}
            />
          </TouchableOpacity>
        )}

        {/* Botão 2: fotos */}
        <TouchableOpacity
          style={[styles.actionButton, (photoLocked) && styles.actionButtonDisabled]}
          onPress={photoLocked ? undefined : handleTakePhoto}
          activeOpacity={photoLocked ? 1 : 0.8}
          disabled={photoLocked}
        >
          <Text style={[styles.actionButtonText, (photoLocked) && styles.actionButtonTextDisabled]}>
            {photoLabel}
          </Text>
          <MaterialIcons
            name={photoLocked ? 'check-circle' : 'photo-camera'}
            size={20}
            color={photoLocked ? GOLD : '#000'}
          />
        </TouchableOpacity>
      </View>
    );
  };

  // 1) pegue o código diretamente do payload (sem fallback para id)
  const headerCode = String((entrega as any)?.corrida_code || '').trim() || '—';

  // 2) renderize o header usando APENAS corrida_code
  const Header = useMemo(() => (
    <View style={[styles.headerWrap, { marginTop: headerTopOffset }]}>
      <Text style={styles.headerTitle}>
        Entrega iniciada <Text style={styles.headerId}>#{headerCode}</Text>
      </Text>
    </View>
  ), [headerCode, headerTopOffset]);

  const contentStyle =
    tab === 'RETORNO'
      ? [styles.contentGrow, styles.centerContent, { paddingTop: contentTopPad, paddingBottom: contentBottomPad }]
      : [styles.contentGrow, { paddingTop: contentTopPad, paddingBottom: contentBottomPad }];

  const displayColeta = canonicalizeAddress(entrega.coleta_endereco);
  const displayEntrega = canonicalizeAddress(entrega.entrega_endereco);

  // —————————————————— render ——————————————————
  return (
    <View style={styles.container}>
      {Header}

      <View style={[styles.tabBar, { marginTop: Math.round(headerTopOffset * 0.25) }]}>
        {(['ORIGEM', 'DESTINO', 'RETORNO', 'MAIS'] as TabKey[]).map((k) => {
          const active = tab === k;
          return (
            <TouchableOpacity key={k} style={[styles.tabBtn, active && styles.tabBtnActive]} onPress={() => setTab(k)}>
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{k === 'MAIS' ? 'MAIS INFOS' : k}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView style={styles.body} contentContainerStyle={contentStyle} showsVerticalScrollIndicator={false}>
        {tab === 'ORIGEM' && (
          <View style={styles.section}>
            <ActionButtons />

            <Field label="Cliente:" value={entrega.cliente_nome ?? ''} always />
            <Field label="Endereço:" value={displayColeta} always />
            <Field label="CEP:" value={entrega.coleta_cep} />
            <Field label="Complemento:" value={entrega.coleta_complemento} />
            <Field label="Observações:" value={entrega.coleta_observacoes} />

            <MapBanner />
            <StatusButton />
          </View>
        )}

        {tab === 'DESTINO' && (
          <View style={styles.section}>
            <ActionButtons />

            <Field label="Nome do recebedor:" value={entrega.recebedor_nome ?? ''} always />
            <Field label="Endereço:" value={displayEntrega} always />
            <Field label="CEP:" value={entrega.entrega_cep} />
            <Field label="Telefone:" value={entrega.entrega_telefone} />
            <Field label="Complemento:" value={entrega.entrega_complemento} />
            <Field label="Observações:" value={entrega.entrega_observacoes} />

            <MapBanner />
            <StatusButton />
          </View>
        )}

        {tab === 'RETORNO' && (
          hasRetorno ? (
            <View style={[styles.section, { marginTop: -146 }]}>
              <Field label="Endereço de retorno:" value={displayColeta} always />
            </View>
          ) : (
            <View style={[styles.returnWrap, { marginTop: -146 }]}>
              <Text style={styles.returnText}>Corrida sem retorno</Text>
            </View>
          )
        )}

        {tab === 'MAIS' && (
          <View style={[styles.section, { marginTop: -80, marginLeft: -20 }]}>
            <View style={styles.goldBar}>
              <Text style={styles.goldBarText}>Informações Adicionais</Text>
            </View>
            <View style={{ height: 16 }} />

            {hasRetorno && (
              <View style={styles.infoRow}>
                <MaterialIcons
                  name="subdirectory-arrow-left"
                  size={20}
                  color={GOLD}
                  style={styles.infoIcon}
                />
                <Text style={styles.infoText}>CORRIDA COM RETORNO</Text>
              </View>
            )}

            {signatureRequired && (
              <View style={styles.infoRow}>
                <MaterialIcons
                  name="edit"
                  size={20}
                  color={GOLD}
                  style={styles.infoIcon}
                />
                <Text style={styles.infoText}>COLETAR ASSINATURA DA ENTREGA</Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* ———————————— Modal Nome do Recebedor ———————————— */}
      <Modal animationType="fade" transparent visible={isReceiverModalVisible} onRequestClose={() => setReceiverModalVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Nome do recebedor</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Digite o nome de quem recebeu..."
              placeholderTextColor={`${GOLD}80`}
              value={receiverName}
              onChangeText={setReceiverName}
            />
            <View style={styles.modalButtonRow}>
              <TouchableOpacity style={[styles.modalButton, styles.modalButtonCancel]} onPress={() => setReceiverModalVisible(false)}>
                <Text style={styles.modalButtonText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalButton, styles.modalButtonSave]} onPress={handleSaveReceiver}>
                <Text style={[styles.modalButtonText, { color: '#000' }]}>Salvar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ———————————— Modal de Fotos ———————————— */}
      <Modal animationType="fade" transparent visible={isPhotoModalVisible} onRequestClose={() => setPhotoModalVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Fotos da Entrega</Text>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoScrollView}>
              {takenPhotos.map(uri => (
                <View key={uri} style={styles.photoContainer}>
                  <Image source={{ uri: ensureFileUri(uri) }} style={styles.previewImage} resizeMode="cover" />
                  <TouchableOpacity style={styles.deletePhotoButton} onPress={() => handleRemovePhoto(uri)}>
                    <MaterialIcons name="delete" size={22} color={GOLD} />
                  </TouchableOpacity>
                </View>
              ))}

              <TouchableOpacity style={styles.addPhotoButton} onPress={handleAddPhotoInsideModal}>
                <MaterialIcons name="add-a-photo" size={30} color={GOLD} />
              </TouchableOpacity>
            </ScrollView>

            <TextInput
              style={styles.modalInput}
              placeholder="Descrição da entrega (opcional)"
              placeholderTextColor={`${GOLD}80`}
              value={photoDescription}
              onChangeText={setPhotoDescription}
              multiline
            />

            <View style={styles.modalButtonRow}>
              <TouchableOpacity style={[styles.modalButton, styles.modalButtonCancel]} onPress={() => setPhotoModalVisible(false)}>
                <Text style={styles.modalButtonText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalButton, styles.modalButtonSave]} onPress={handleSavePhoto}>
                <Text style={[styles.modalButtonText, { color: '#000' }]}>Salvar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ———————————— Modal de Assinatura ———————————— */}
      <Modal
        animationType="fade"
        transparent
        visible={isSignatureModalVisible}
        onRequestClose={() => setSignatureModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalContent, { paddingBottom: 16 }]}>
            <Text style={styles.modalTitle}>Coletar Assinatura</Text>

            <View style={styles.signatureBox}>
              <Signature
                ref={signatureRef}
                onOK={handleSignatureOK}
                onEmpty={() => Alert.alert('Aviso', 'Desenhe a assinatura antes de salvar.')}
                webStyle={`
                  .m-signature-pad { box-shadow: none; border: 1px solid ${GOLD}; }
                  .m-signature-pad--body { background: #121212; }
                  .m-signature-pad--footer { display: none; }
                  canvas { background: #121212; }
                `}
                backgroundColor="#121212"
                penColor="#e9e100ff"
                imageType="image/png"
                autoClear={false}
              />
            </View>

            <TextInput
              style={styles.modalInput}
              placeholder="Nome do recebedor (opcional)"
              placeholderTextColor={`${GOLD}80`}
              value={receiverNameForSign}
              onChangeText={setReceiverNameForSign}
            />

            <View style={styles.modalButtonRow}>
              <TouchableOpacity style={[styles.modalButton, styles.signBtnOutline]} onPress={handleClearSignature}>
                <Text style={[styles.modalButtonText, { color: '#000' }]}>Limpar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalButton, styles.signBtnSolid]} onPress={handleSaveSignaturePress}>
                <Text style={[styles.modalButtonText, { color: '#000' }]}>Salvar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ———————————— Modal de erro de hold curto (1,5s) ———————————— */}
      <Modal
        visible={showHoldError}
        transparent
        animationType="fade"
        onRequestClose={() => setShowHoldError(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalContent, { maxWidth: 420 }]}>
            <Text style={styles.modalTitle}>ERRO!</Text>
            <Text style={[styles.modalButtonText, { textAlign: 'center', marginBottom: 16 }]}>
              Precisa pressionar o botão de status por 1,5 segundos
            </Text>
            <View style={styles.modalButtonRow}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonSave]}
                onPress={() => setShowHoldError(false)}
              >
                <Text style={[styles.modalButtonText, { color: '#000' }]}>OK</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },

  headerWrap: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 6 },
  headerTitle: { color: TEXT_GOLD, fontSize: 24, fontWeight: '900', textAlign: 'center' },
  headerId: { color: TEXT_GOLD, fontWeight: '900' },

  tabBar: { flexDirection: 'row', backgroundColor: TAB_BG, borderBottomWidth: 1, borderBottomColor: GOLD, paddingTop: 6, paddingBottom: 4 },
  tabBtn: { flex: 1, paddingVertical: 14, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabBtnActive: { borderBottomColor: GOLD },
  tabText: { color: TEXT_GOLD, fontWeight: '900', letterSpacing: 0.5, opacity: 0.7 },
  tabTextActive: { color: TEXT_GOLD, opacity: 1 },

  body: { flex: 1 },
  contentGrow: { flexGrow: 1, paddingHorizontal: 22 },
  centerContent: { justifyContent: 'center' },

  section: { gap: 14 },

  fieldRow: { marginBottom: 12 },
  fieldLabel: { color: TEXT_GOLD, fontWeight: '900', marginBottom: 2, fontSize: 16, lineHeight: 20 },
  fieldValue: { color: TEXT_GOLD, fontSize: 17, lineHeight: 24, opacity: 0.95 },

  mapBanner: {
    marginTop: 10, width: '100%', backgroundColor: GOLD, borderRadius: 14,
    paddingVertical: 14, paddingHorizontal: 16, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'space-between',
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 }, elevation: 3
  },
  mapBannerTextWrap: { flexShrink: 1, paddingRight: 12 },
  mapBannerTitle: { color: '#000', fontWeight: '900', fontSize: 16, marginBottom: 2 },
  mapBannerSubtitle: { color: '#000', opacity: 0.8, fontSize: 13, lineHeight: 18 },
  mapBannerIconBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: GOLD },

  statusBtn: {
    marginTop: 12,
    width: '100%',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: '#0b0b0b',
    borderWidth: 1,
    borderColor: GOLD,
    alignItems: 'center',
    justifyContent: 'center'
  },
  statusBtnText: { color: TEXT_GOLD, fontWeight: '900', fontSize: 16, letterSpacing: 0.3 },

  returnWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 24, minHeight: 360 },
  returnText: { color: TEXT_GOLD, fontWeight: '900', fontSize: 26, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 16, borderWidth: 1, borderColor: GOLD, textAlign: 'center' },

  goldBar: { width: '100%', backgroundColor: GOLD, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10 },
  goldBarText: { color: '#000', fontWeight: '900', fontSize: 16, textTransform: 'none' },

  actionButtonsContainer: { gap: 10, marginBottom: 10 },
  actionButton: {
    backgroundColor: GOLD,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center'
  },
  actionButtonDisabled: {
    backgroundColor: '#0b0b0b',
    borderWidth: 1,
    borderColor: GOLD,
  },
  actionButtonText: { color: '#000', fontWeight: 'bold', fontSize: 16, marginRight: 10 },
  actionButtonTextDisabled: { color: GOLD },

  // ———— Modal base ————
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { backgroundColor: '#000', borderWidth: 1, borderColor: GOLD, borderRadius: 16, padding: 20, width: '90%' },
  modalTitle: { color: GOLD, fontSize: 20, fontWeight: 'bold', marginBottom: 15, textAlign: 'center' },
  modalInput: { backgroundColor: '#1C1C1E', color: GOLD, borderWidth: 1, borderColor: GOLD, borderRadius: 8, paddingHorizontal: 15, paddingVertical: 12, fontSize: 16, marginBottom: 20 },
  modalButtonRow: { flexDirection: 'row', justifyContent: 'space-between' },
  modalButton: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  modalButtonCancel: { backgroundColor: '#333', marginRight: 10 },
  modalButtonSave: { backgroundColor: GOLD },
  modalButtonText: { color: GOLD, fontWeight: 'bold', fontSize: 16 },

  // ———— Fotos no modal ————
  photoScrollView: { marginBottom: 20 },
  photoContainer: { marginRight: 10 },
  previewImage: { width: 100, height: 100, borderRadius: 8, backgroundColor: '#1C1C1E' },
  deletePhotoButton: { position: 'absolute', top: -6, right: -6, backgroundColor: '#000', borderRadius: 14, padding: 2 },
  addPhotoButton: {
    width: 100, height: 100, borderRadius: 8, backgroundColor: '#1C1C1E',
    borderWidth: 1, borderColor: GOLD, justifyContent: 'center', alignItems: 'center'
  },

  // ———— Assinatura ————
  signatureBox: {
    borderWidth: 1,
    borderColor: GOLD,
    borderRadius: 10,
    overflow: 'hidden',
    height: 220,
    marginBottom: 16,
    backgroundColor: '#121212',
  },
  signBtnSolid: {
    backgroundColor: GOLD,
    marginLeft: 10,
    borderWidth: 1,
    borderColor: '#000',
  },
  signBtnOutline: {
    backgroundColor: GOLD,
    borderWidth: 1,
    borderColor: '#000',
    marginRight: 10,
  },

  // ———— Linhas de info na aba MAIS ————
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: GOLD,
    paddingHorizontal: 0,
  },
  infoIcon: {
    marginRight: 10,
  },
  infoText: {
    color: GOLD,
    fontWeight: '900',
    fontSize: 16,
    letterSpacing: 0.3,
  },
});
