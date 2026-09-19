import "dotenv/config";

const KANEO_API_URL = process.env.KANEO_API_URL;
const KANEO_API_KEY = process.env.KANEO_API_KEY;
const KANEO_PROJECT_ID = process.env.KANEO_PROJECT_ID;

if (!KANEO_API_URL || !KANEO_API_KEY || !KANEO_PROJECT_ID) {
  console.error(
    "Defina KANEO_API_URL, KANEO_API_KEY e KANEO_PROJECT_ID no ambiente antes de rodar este script.",
  );
  process.exit(1);
}

interface CreatedField {
  id: string;
  name: string;
}

async function createField(
  name: string,
  type: "text" | "dropdown",
  options?: string[],
): Promise<CreatedField> {
  const res = await fetch(`${KANEO_API_URL}/custom-field`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": KANEO_API_KEY as string,
    },
    body: JSON.stringify({
      projectId: KANEO_PROJECT_ID,
      name,
      type,
      options,
    }),
  });

  if (!res.ok) {
    throw new Error(`Falha ao criar campo "${name}": ${res.status} ${await res.text()}`);
  }

  return (await res.json()) as CreatedField;
}

async function main() {
  const phoneField = await createField("Telefone", "text");
  console.log(`KANEO_FIELD_PHONE_ID=${phoneField.id}`);

  const customerTypeField = await createField("Tipo de Cliente", "dropdown", ["Interno", "Externo"]);
  console.log(`KANEO_FIELD_CUSTOMER_TYPE_ID=${customerTypeField.id}`);

  const nameField = await createField("Nome", "text");
  console.log(`KANEO_FIELD_NAME_ID=${nameField.id}`);

  const emailField = await createField("Email", "text");
  console.log(`KANEO_FIELD_EMAIL_ID=${emailField.id}`);

  console.log("\nCopie as quatro linhas acima para bridge/.env.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
