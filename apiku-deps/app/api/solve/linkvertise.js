/**
 * Linkvertise Bypass
 * Bypass link monetization dari Linkvertise via GraphQL API resminya.
 * Supports: URL biasa (user_id/slug), dynamic URL (?r=base64), access/download prefix
 *
 * GET  /api/solve/linkvertise?url=<linkvertise-url>
 * POST /api/solve/linkvertise -d {"url": "..."}
 */

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const GRAPHQL_ENDPOINT = 'https://publisher.linkvertise.com/graphql';

function parseLinkvertiseUrl(inputUrl) {
  let target = inputUrl.trim();
  if (!/^https?:\/\//i.test(target)) {
    target = 'https://' + target;
  }
  const parsed = new URL(target);

  const rParam = parsed.searchParams.get('r');
  if (rParam) {
    try {
      const decoded = Buffer.from(rParam, 'base64').toString('utf-8');
      if (/^https?:\/\//i.test(decoded)) {
        return { isDynamic: true, dynamicUrl: decoded };
      }
    } catch {}
  }

  let segments = parsed.pathname.split('/').filter(Boolean);
  if (segments[0] === 'access' || segments[0] === 'download') {
    segments.shift();
  }

  if (segments.length >= 2) {
    return { userId: segments[0], urlSlug: segments[1] };
  }

  if (segments.length === 1) {
    return { userId: null, urlSlug: segments[0] };
  }

  throw new Error('Invalid Linkvertise URL: unable to extract user ID and url slug');
}

async function requestGraphQL(query, variables, refererUrl, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Origin: 'https://linkvertise.com',
        Referer: refererUrl,
        cqreferrer: refererUrl,
        'User-Agent': DEFAULT_USER_AGENT
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal
    });

    if (!res.ok) {
      throw new Error(`Linkvertise GraphQL HTTP error ${res.status}: ${res.statusText}`);
    }

    return await res.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function bypassLinkvertise(inputUrl, options = {}) {
  const startTime = Date.now();
  const timeoutMs = options.timeoutMs || 30000;
  const maxAttempts = options.maxAttempts || 10;
  const stepDelayMs = options.stepDelayMs || 600;

  const parsedInfo = parseLinkvertiseUrl(inputUrl);

  if (parsedInfo.isDynamic) {
    return {
      success: true,
      original_url: inputUrl,
      title: null,
      target_type: 'URL',
      destination_url: parsedInfo.dynamicUrl,
      publisher: null,
      is_dynamic: true,
      execution_time_ms: Date.now() - startTime
    };
  }

  const { userId, urlSlug } = parsedInfo;
  const refererUrl = userId
    ? `https://linkvertise.com/access/${userId}/${urlSlug}`
    : `https://linkvertise.com/${urlSlug}`;

  const identifier = userId
    ? { userIdAndUrl: { user_id: String(userId), url: urlSlug } }
    : { userIdAndUrl: { user_id: '0', url: urlSlug } };

  const infoQuery = `query getLinkByIdentifier($identifier: PublicLinkIdentificationInput!) {
    linkByIdentifier(linkIdentificationInput: $identifier) {
      id title url target_type target_host favicon_url description
      publisher { id name }
    }
  }`;

  const infoJson = await requestGraphQL(infoQuery, { identifier }, refererUrl, timeoutMs);
  const linkDetails = infoJson?.data?.linkByIdentifier;

  if (!linkDetails) {
    throw new Error('Linkvertise target link not found or has been deleted');
  }

  const contentQuery = `query getContent($identifier: PublicLinkIdentificationInput!) {
    getContent(input: $identifier) {
      __typename
      ... on DetailPageTargetData { type url paste }
      ... on ContentAccessTaskSet {
        tasks {
          __typename id
          ... on WaitTask { status remainingWaitingTime }
          ... on AdTask { status adIndex adsTotal }
        }
      }
    }
  }`;

  const completeMutation = `mutation completeTask($identifier: PublicLinkIdentificationInput!, $task_id: String!, $task_args: TaskArgument) {
    completeTask(input: $identifier, task_id: $task_id, task_args: $task_args) {
      id __typename
      ... on AdTask { status adIndex adsTotal }
      ... on WaitTask { status remainingWaitingTime }
    }
  }`;

  let finalTarget = null;
  let attempts = 0;

  while (attempts < maxAttempts) {
    attempts++;

    const contentJson = await requestGraphQL(contentQuery, { identifier }, refererUrl, timeoutMs);
    const contentData = contentJson?.data?.getContent;

    if (!contentData) {
      if (contentJson?.errors?.length) {
        throw new Error(`GraphQL error: ${contentJson.errors[0].message}`);
      }
      throw new Error('Unexpected empty content response from Linkvertise');
    }

    if (contentData.__typename === 'DetailPageTargetData') {
      finalTarget = contentData;
      break;
    }

    if (contentData.__typename === 'ContentAccessTaskSet') {
      const taskList = contentData.tasks || [];
      let didAct = false;

      for (const task of taskList) {
        if (!task.status || task.status === 'IN_PROGRESS') {
          await requestGraphQL(
            completeMutation,
            { identifier, task_id: task.id, task_args: null },
            refererUrl,
            timeoutMs
          );
          didAct = true;
        }
      }

      if (!didAct && taskList.length > 0) {
        const first = taskList[0];
        await requestGraphQL(
          completeMutation,
          { identifier, task_id: first.id, task_args: null },
          refererUrl,
          timeoutMs
        );
      }
    }

    await new Promise((resolve) => setTimeout(resolve, stepDelayMs));
  }

  if (!finalTarget) {
    throw new Error(`Failed to bypass Linkvertise tasks within ${maxAttempts} attempts`);
  }

  const destination = finalTarget.url || finalTarget.paste;

  return {
    success: true,
    original_url: inputUrl,
    link_id: linkDetails.id,
    title: linkDetails.title,
    target_type: finalTarget.type || linkDetails.target_type,
    target_host: linkDetails.target_host,
    favicon_url: linkDetails.favicon_url,
    description: linkDetails.description,
    publisher: linkDetails.publisher,
    destination_url: destination,
    attempts,
    execution_time_ms: Date.now() - startTime
  };
}

export default {
  name: 'Linkvertise Bypass',
  description:
    'Bypass link monetization Linkvertise dan dapatkan URL tujuan aslinya. Mendukung URL biasa (user_id/slug), dynamic link (?r=base64), serta prefix access/ dan download/.',
  category: 'Solve',
  methods: ['GET', 'POST'],
  params: ['url'],
  paramsSchema: {
    url: {
      type: 'string',
      required: true,
      description: 'URL Linkvertise yang ingin di-bypass',
      example: 'https://linkvertise.com/327574/samp-0-3-7'
    }
  },

  async run(req, res) {
    const { url, link } = { ...req.query, ...req.body };
    const target = (url || link || '').toString().trim();

    if (!target) {
      return res.status(400).json({
        status: false,
        message: "Parameter 'url' wajib diisi"
      });
    }

    try {
      const result = await bypassLinkvertise(target);
      return res.json({
        status: true,
        result
      });
    } catch (err) {
      return res.status(500).json({
        status: false,
        message: err.message || 'Gagal bypass Linkvertise'
      });
    }
  }
};
