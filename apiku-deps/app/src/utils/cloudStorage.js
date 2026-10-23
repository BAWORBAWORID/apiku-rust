import {
  CognitoIdentityClient,
  GetIdCommand,
  GetCredentialsForIdentityCommand,
} from "@aws-sdk/client-cognito-identity";
  import {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
  } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { SignatureV4 } from "@smithy/signature-v4";
import { Sha256 } from "@aws-crypto/sha256-js";
import { HttpRequest } from "@smithy/protocol-http";

const CONFIG = {
  region: "us-east-1",
  identityPoolId: "us-east-1:3b2f9a16-a4b2-4045-9255-453415bad9b6",
  s3Bucket: "amplify-mindbytebackend-j-mindbyteappbucket40d036a-nhen0zx97aq3",
  appsyncUrl: "https://l4xs67tsanblbn3gu4r33i76xe.appsync-api.us-east-1.amazonaws.com/graphql",
};

let cachedCreds = null;
let cachedIdentityId = null;
let cognitoClient = null;

async function getCredentials() {
  if (cachedCreds) return cachedCreds;

  if (!cognitoClient) {
    cognitoClient = new CognitoIdentityClient({ region: CONFIG.region });
  }

  const idResp = await cognitoClient.send(
    new GetIdCommand({ IdentityPoolId: CONFIG.identityPoolId })
  );
  cachedIdentityId = idResp.IdentityId;

  const credsResp = await cognitoClient.send(
    new GetCredentialsForIdentityCommand({ IdentityId: cachedIdentityId })
  );
  const c = credsResp.Credentials;
  cachedCreds = {
    accessKeyId: c.AccessKeyId,
    secretAccessKey: c.SecretKey,
    sessionToken: c.SessionToken,
    expiration: c.Expiration,
  };
  return cachedCreds;
}

function getS3Client(creds) {
  return new S3Client({
    region: CONFIG.region,
    credentials: {
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
      sessionToken: creds.sessionToken,
    },
  });
}

async function appsyncQuery(query, variables = null) {
  const creds = await getCredentials();
  const body = { query };
  if (variables) body.variables = variables;

  const payload = JSON.stringify(body);
  const url = new URL(CONFIG.appsyncUrl);
  const request = new HttpRequest({
    method: "POST",
    hostname: url.hostname,
    path: url.pathname,
    protocol: url.protocol,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      host: url.hostname,
    },
    body: payload,
  });

  const signer = new SignatureV4({
    credentials: {
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
      sessionToken: creds.sessionToken,
    },
    region: CONFIG.region,
    service: "appsync",
    sha256: Sha256,
  });

  const signed = await signer.sign(request);
  const resp = await fetch(CONFIG.appsyncUrl, {
    method: "POST",
    headers: signed.headers,
    body: payload,
  });

  return resp.json();
}

function generateBackupId() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 22; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result + "2";
}

let cachedBackupId = null;

export async function getOrCreateBackup() {
  const bid = generateBackupId();
  const query = `query GetBackupAppTable($id: ID!) {
    getBackupAppTable(id: $id) { createdAt id name spaceUsed totalSpace updatedAt }
  }`;
  const data = await appsyncQuery(query, { id: bid });
  const result = data.data?.getBackupAppTable;
  if (result) {
    cachedBackupId = result.id;
    return result;
  }

  const mutation = `mutation CreateBackupAppTable($input: CreateBackupAppTableInput!) {
    createBackupAppTable(input: $input) {
      createdAt id name spaceUsed totalSpace updatedAt
    }
  }`;
  const inp = {
    id: bid,
    name: bid,
    totalSpace: "1099511627776",
    spaceUsed: "0",
  };
  const createData = await appsyncQuery(mutation, { input: inp });
  const created = createData.data.createBackupAppTable;
  cachedBackupId = created.id;
  return created;
}

export async function getStorageInfo() {
  if (!cachedBackupId) await getOrCreateBackup();
  const query = `query GetBackupAppTable($id: ID!) {
    getBackupAppTable(id: $id) { spaceUsed totalSpace }
  }`;
  const data = await appsyncQuery(query, { id: cachedBackupId });
  const result = data.data.getBackupAppTable;
  const spaceUsed = parseInt(result.spaceUsed, 10);
  const totalSpace = parseInt(result.totalSpace, 10);
  return {
    spaceUsed,
    totalSpace,
    usedPercent: parseFloat(((spaceUsed / totalSpace) * 100).toFixed(2)),
    remaining: totalSpace - spaceUsed,
    backupId: cachedBackupId,
  };
}

export async function uploadToCloudStorage(buffer, filename) {
  const creds = await getCredentials();
  const s3 = getS3Client(creds);

  const s3Key = `public/uploads/${Date.now()}-${filename}`;

  await s3.send(new PutObjectCommand({
    Bucket: CONFIG.s3Bucket,
    Key: s3Key,
    Body: buffer,
  }));

  const url = await getSignedUrl(s3, new GetObjectCommand({
    Bucket: CONFIG.s3Bucket,
    Key: s3Key,
  }), { expiresIn: 86400 });

  return url;
}

  export async function deleteFromCloudStorage(key) {
    const creds = await getCredentials();
    const s3 = getS3Client(creds);

    await s3.send(new DeleteObjectCommand({
      Bucket: CONFIG.s3Bucket,
      Key: key,
    }));
  }

  export function extractS3KeyFromUrl(url) {
    try {
      const u = new URL(url);
      if (!u.hostname.endsWith(".amazonaws.com")) return null;
      const p = u.pathname;
      return p.startsWith("/") ? p.slice(1) : p;
    } catch {
      return null;
    }
  }

  export async function resetCloudStorage() {
  cachedCreds = null;
  cachedIdentityId = null;
  cognitoClient = null;
  cachedBackupId = null;
}
