import type {
  BoardApiResponse,
  ClaimSlotRequest,
  ClaimSlotResponse,
  MarketApiResponse,
  RequestEditNonceRequest,
  RequestEditNonceResponse,
  UpdateSlotRequest,
  UpdateSlotResponse,
} from "../shared/types";

async function parseJson<T>(response: Response): Promise<T> {
  const data = (await response.json()) as T;
  if (!response.ok) {
    throw new Error((data as { message?: string }).message ?? "Request failed.");
  }
  return data;
}

export async function fetchBoard() {
  const response = await fetch("/api/board");
  return parseJson<BoardApiResponse>(response);
}


export async function fetchMarket() {
  const response = await fetch("/api/market");
  return parseJson<MarketApiResponse>(response);
}

export async function claimSlot(body: ClaimSlotRequest) {
  const response = await fetch("/api/claim-slot", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const raw = await response.text();

  try {
    return JSON.parse(raw) as ClaimSlotResponse;
  } catch {
    return {
      ok: false,
      reason: "invalid_tx",
      message: response.ok
        ? "The board claim returned an unreadable response. Refresh and try again."
        : "The board claim endpoint failed. Refresh and try again.",
    } satisfies ClaimSlotResponse;
  }
}

export async function requestEditNonce(body: RequestEditNonceRequest) {
  const response = await fetch("/api/request-edit-nonce", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return parseJson<RequestEditNonceResponse>(response);
}

export async function updateSlot(body: UpdateSlotRequest) {
  const response = await fetch("/api/update-slot", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return parseJson<UpdateSlotResponse>(response);
}
