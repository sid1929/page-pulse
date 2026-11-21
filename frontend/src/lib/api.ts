
const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export async function checkBackendHealth() {
  const response = await fetch(`${API_URL}/health`);

  if (!response.ok) {
    throw new Error("Backend health check failed");
  }

  return response.json();
}

export async function scanWebsite(url: string) {
  const response = await fetch(`${API_URL}/audit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message || "Website scan failed"
    );
  }

  return data;
}
