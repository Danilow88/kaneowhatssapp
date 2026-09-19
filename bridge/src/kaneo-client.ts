import { env } from "./config.ts";

export interface KaneoTask {
  id: string;
  number: number | null;
  title: string;
  status: string;
  priority: string;
}

async function kaneoFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${env.KANEO_API_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-api-key": env.KANEO_API_KEY,
      ...init.headers,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Kaneo API ${init.method ?? "GET"} ${path} -> ${res.status}: ${text}`);
  }

  return (await res.json()) as T;
}

export async function createTicketTask(params: {
  title: string;
  description: string;
  phone: string;
  customerType: string;
  name: string;
  email: string;
}): Promise<KaneoTask> {
  return kaneoFetch<KaneoTask>(`/task/${env.KANEO_PROJECT_ID}`, {
    method: "POST",
    body: JSON.stringify({
      title: params.title,
      description: params.description,
      status: "to-do",
      priority: "medium",
      customFields: [
        { fieldId: env.KANEO_FIELD_PHONE_ID, value: params.phone },
        { fieldId: env.KANEO_FIELD_CUSTOMER_TYPE_ID, value: params.customerType },
        { fieldId: env.KANEO_FIELD_NAME_ID, value: params.name },
        { fieldId: env.KANEO_FIELD_EMAIL_ID, value: params.email },
      ],
    }),
  });
}

export async function getTask(taskId: string): Promise<KaneoTask> {
  return kaneoFetch<KaneoTask>(`/task/${taskId}`, { method: "GET" });
}

export async function addComment(taskId: string, content: string): Promise<void> {
  await kaneoFetch(`/comment/${taskId}`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}

export async function setTaskStatus(taskId: string, status: string): Promise<void> {
  await kaneoFetch(`/task/status/${taskId}`, {
    method: "PUT",
    body: JSON.stringify({ status }),
  });
}
