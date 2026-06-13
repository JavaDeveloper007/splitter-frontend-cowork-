import { create } from 'zustand';
import type {
  FinalizeReceiptResponse,
  FinalizeReceiptItemPayload,
  FinalizeTotalsByItem,
  FinalizeTotalsByParticipant,
  ParseReceiptRequest,
  ParseReceiptByUrlRequest,
  ParseReceiptLocalRequest,
  ParseReceiptResponse,
  ReceiptParticipant,
  ReceiptSummary,
  ReceiptSplitMode,
  ReceiptAllocation,
} from '@/features/receipt/api/receipt.api';
import { ReceiptApi } from '@/features/receipt/api/receipt.api';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ScanMode = 'gemini' | 'qr' | 'local';

export type CapturedReceiptImage = {
  uri?: string;
  mimeType: string;
  base64: string;
  width?: number;
  height?: number;
};

export interface ReceiptSplitItem {
  id: string;
  name: string;
  unitPrice: number;
  quantity: number;
  totalPrice: number;
  kind?: string;
  splitMode: ReceiptSplitMode;
  assignedTo: string[];
  perPersonCount: Record<string, number>;
}

export interface ReceiptSessionMeta {
  sessionId: number;
  sessionName: string;
  language: string;
  summary?: ReceiptSummary;
}

export type FinishPayload = {
  sessionId?: number;
  sessionName?: string;
  receiptId?: string;
  participants?: ReceiptParticipant[];
  totals?: Record<string, number>;
  totalsByParticipant?: FinalizeTotalsByParticipant[];
  totalsByItem?: FinalizeTotalsByItem[];
  allocations?: ReceiptAllocation[];
  status?: string;
  createdAt?: string;
  grandTotal?: number;
  currency?: string;
};

// ─── Store interface ──────────────────────────────────────────────────────────

interface ReceiptSessionStore {
  capture?: CapturedReceiptImage;
  parsing: boolean;
  parseError?: string;
  session?: ReceiptSessionMeta;
  items: ReceiptSplitItem[];
  participants: ReceiptParticipant[];
  currency: string;
  finalizing: boolean;
  finalizeError?: string;
  finalized?: FinalizeReceiptResponse;
  lastFinishPayload?: FinishPayload;

  setCapture: (capture?: CapturedReceiptImage) => void;
  clearCapture: () => void;
  setSessionName: (sessionName: string) => void;
  setParticipants: (participants: ReceiptParticipant[]) => void;
  setCurrency: (currency: string) => void;
  updateItem: (itemId: string, updater: (prev: ReceiptSplitItem) => ReceiptSplitItem) => void;
  setItems: (items: ReceiptSplitItem[]) => void;
  setLastFinishPayload: (payload?: FinishPayload) => void;

  parseReceipt: (payload: ParseReceiptRequest) => Promise<ParseReceiptResponse>;
  parseReceiptByUrl: (payload: ParseReceiptByUrlRequest) => Promise<ParseReceiptResponse>;
  parseReceiptLocal: (payload: ParseReceiptLocalRequest) => Promise<ParseReceiptResponse>;
  finalizeSession: () => Promise<FinalizeReceiptResponse>;
  reset: () => void;
}

// ─── Initial state ────────────────────────────────────────────────────────────

const INITIAL_STATE: Pick<ReceiptSessionStore,
  'capture' | 'parsing' | 'parseError' | 'session' | 'items' | 'participants' |
  'currency' | 'finalizing' | 'finalizeError' | 'finalized' | 'lastFinishPayload'
> = {
  capture: undefined,
  parsing: false,
  parseError: undefined,
  session: undefined,
  items: [],
  participants: [],
  currency: 'UZS',
  finalizing: false,
  finalizeError: undefined,
  finalized: undefined,
  lastFinishPayload: undefined,
};

// ─── Helper — applies parse response to store state ───────────────────────────

function buildSplitItems(response: ParseReceiptResponse): ReceiptSplitItem[] {
  return response.items.map((item) => ({
    id: item.id,
    name: item.name,
    unitPrice: item.unitPrice,
    quantity: item.quantity,
    totalPrice: item.totalPrice,
    kind: item.kind,
    splitMode: item.quantity > 1 ? 'count' : 'equal',
    assignedTo: [],
    perPersonCount: {},
  }));
}

function applyParseResponse(response: ParseReceiptResponse) {
  return {
    parsing: false,
    parseError: undefined,
    session: {
      sessionId: response.sessionId,
      sessionName: response.sessionName,
      language: response.language,
      summary: response.summary,
    },
    items: buildSplitItems(response),
    participants: [],
    currency: response.summary?.currency || 'UZS',
    finalized: undefined,
    finalizeError: undefined,
  };
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useReceiptSessionStore = create<ReceiptSessionStore>((set, get) => ({
  ...INITIAL_STATE,

  setCapture: (capture) => set({ capture }),
  clearCapture: () => set({ capture: undefined }),

  setSessionName: (sessionName) => {
    set((state) => {
      if (!state.session) return {};
      return { session: { ...state.session, sessionName } };
    });
  },

  setParticipants: (participants) => set({ participants }),
  setCurrency: (currency) => set({ currency }),
  updateItem: (itemId, updater) => {
    set((state) => ({
      items: state.items.map((item) => item.id === itemId ? updater(item) : item),
    }));
  },
  setItems: (items) => set({ items }),
  setLastFinishPayload: (payload) => set({ lastFinishPayload: payload }),

  // Gemini AI (camera)
  parseReceipt: async (payload) => {
    set({ parsing: true, parseError: undefined });
    try {
      const response = await ReceiptApi.parse(payload);
      set(applyParseResponse(response));
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to parse receipt';
      set({ parsing: false, parseError: message });
      throw error;
    }
  },

  // QR Link
  parseReceiptByUrl: async (payload) => {
    set({ parsing: true, parseError: undefined });
    try {
      const response = await ReceiptApi.parseByUrl(payload);
      set(applyParseResponse(response));
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to parse receipt from QR';
      set({ parsing: false, parseError: message });
      throw error;
    }
  },

  // Local AI (camera)
  parseReceiptLocal: async (payload) => {
    set({ parsing: true, parseError: undefined });
    try {
      const response = await ReceiptApi.parseLocal(payload);
      set(applyParseResponse(response));
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to parse receipt with local AI';
      set({ parsing: false, parseError: message });
      throw error;
    }
  },

  finalizeSession: async () => {
    const { session, participants, items, currency } = get();
    if (!session) throw new Error('No session to finalize');
    if (participants.length === 0) throw new Error('Add at least one participant');

    const payloadItems: FinalizeReceiptItemPayload[] = items.map((item) => ({
      id: item.id,
      name: item.name,
      price: item.unitPrice,
      quantity: item.quantity,
      kind: item.kind,
      splitMode: item.splitMode,
      assignedTo: item.splitMode === 'equal' ? item.assignedTo : undefined,
      perPersonCount: item.splitMode === 'count' ? item.perPersonCount : undefined,
    }));

    set({ finalizing: true, finalizeError: undefined });
    try {
      const response = await ReceiptApi.finalize({
        sessionId: session.sessionId,
        sessionName: session.sessionName,
        participants,
        items: payloadItems,
        currency,
      });

      const nextState: Partial<ReceiptSessionStore> = {
        finalizing: false,
        finalized: response,
        finalizeError: undefined,
        lastFinishPayload: {
          sessionId: response.sessionId,
          sessionName: response.sessionName,
          participants,
          totalsByParticipant: response.totals?.byParticipant,
          totalsByItem: response.totals?.byItem,
          allocations: response.allocations,
          grandTotal: response.totals?.grandTotal,
          currency: response.totals?.currency ?? currency,
          status: response.status,
          createdAt: response.createdAt,
        },
      };

      if (response.totals?.currency) {
        nextState.currency = response.totals.currency;
      }

      set(nextState);
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to finalize session';
      set({ finalizing: false, finalizeError: message });
      throw error;
    }
  },

  reset: () => set({ ...INITIAL_STATE }),
}));
