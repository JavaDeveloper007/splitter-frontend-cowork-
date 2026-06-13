import { apiClient } from '@/features/auth/api';

// ─── Shared types ─────────────────────────────────────────────────────────────

export type ReceiptImagePayload = {
  mimeType: string;
  data: string; // base64 without data URI prefix
};

export type ParsedReceiptItemKind = 'item' | 'fee' | 'discount' | string;

export interface ParsedReceiptItem {
  id: string;
  name: string;
  unitPrice: number;
  quantity: number;
  totalPrice: number;
  kind?: ParsedReceiptItemKind;
}

export interface ReceiptSummary {
  grandTotal: number;
  currency?: string;
  [key: string]: unknown;
}

export interface ParseReceiptResponse {
  sessionId: number;
  sessionName: string;
  language: string;
  items: ParsedReceiptItem[];
  summary?: ReceiptSummary;
  source?: 'gemini' | 'scraper' | 'local_ai' | 'mock';
}

export type ReceiptParticipant = {
  uniqueId: string;
  username: string;
};

export type ReceiptSplitMode = 'equal' | 'count';

export interface FinalizeReceiptItemPayload {
  id: string;
  name: string;
  price: number;
  quantity: number;
  kind?: ParsedReceiptItemKind;
  splitMode: ReceiptSplitMode;
  assignedTo?: string[];
  perPersonCount?: Record<string, number>;
}

export interface FinalizeReceiptRequest {
  sessionId: number;
  sessionName: string;
  participants: ReceiptParticipant[];
  items: FinalizeReceiptItemPayload[];
  currency?: string;
}

export interface FinalizeTotalsByParticipant {
  uniqueId: string;
  username: string;
  amountOwed: number;
}

export interface FinalizeTotalsByItem {
  itemId: string;
  name: string;
  total: number;
}

export interface ReceiptAllocation {
  itemId: string;
  participantId: string;
  shareAmount: number;
  shareUnits?: number;
  shareRatio?: number;
}

export interface FinalizeReceiptResponse {
  sessionId: number;
  sessionName: string;
  status: string;
  createdAt: string;
  totals: {
    grandTotal: number;
    currency?: string;
    byParticipant?: FinalizeTotalsByParticipant[];
    byItem?: FinalizeTotalsByItem[];
  };
  allocations?: ReceiptAllocation[];
}

// ─── Request types per mode ───────────────────────────────────────────────────

export interface ParseReceiptRequest {
  sessionName: string;
  language: string;
  image: ReceiptImagePayload;
}

export interface ParseReceiptByUrlRequest {
  sessionName: string;
  url: string;
}

export interface ParseReceiptLocalRequest {
  sessionName: string;
  language: string;
  image: ReceiptImagePayload;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const normalizeError = (error: unknown): Error => {
  if (error instanceof Error) return error;
  return new Error('Unexpected error');
};

// ─── API ─────────────────────────────────────────────────────────────────────

export const ReceiptApi = {

  // Gemini AI — камера → облако
  async parse(payload: ParseReceiptRequest): Promise<ParseReceiptResponse> {
    try {
      const { data } = await apiClient.post<ParseReceiptResponse>('/sessions/scan', payload);
      console.log('[API] /sessions/scan response:', JSON.stringify(data, null, 2));
      return data;
    } catch (error) {
      console.error('[API] Error (parse):', error);
      throw normalizeError(error);
    }
  },

  // QR Link — ссылка с чека → scraper на бэкенде
  async parseByUrl(payload: ParseReceiptByUrlRequest): Promise<ParseReceiptResponse> {
    try {
      const { data } = await apiClient.post<ParseReceiptResponse>('/sessions/scan-qr', {
        url: payload.url,
        sessionName: payload.sessionName,
      });
      console.log('[API] /sessions/scan-qr response:', JSON.stringify(data, null, 2));
      return data;
    } catch (error) {
      console.error('[API] Error (parseByUrl):', error);
      throw normalizeError(error);
    }
  },

  // Local AI — камера → локальный FastAPI (EasyOCR + Ollama)
  async parseLocal(payload: ParseReceiptLocalRequest): Promise<ParseReceiptResponse> {
    try {
      const { data } = await apiClient.post<ParseReceiptResponse>('/sessions/scan-local', {
        sessionName: payload.sessionName,
        language: payload.language,
        image: payload.image,
      });
      console.log('[API] /sessions/scan-local response:', JSON.stringify(data, null, 2));
      return data;
    } catch (error) {
      console.error('[API] Error (parseLocal):', error);
      throw normalizeError(error);
    }
  },

  async finalize(payload: FinalizeReceiptRequest): Promise<FinalizeReceiptResponse> {
    try {
      console.log('[API] POST /sessions/finalize');
      const { data } = await apiClient.post<FinalizeReceiptResponse>('/sessions/finalize', payload);
      console.log('[API] Response:', JSON.stringify(data, null, 2));
      return data;
    } catch (error) {
      console.error('[API] Error (finalize):', error);
      throw normalizeError(error);
    }
  },
};
