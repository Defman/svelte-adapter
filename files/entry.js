import { init, render } from "../output/server/app.js";
import { getAssetFromKV, NotFoundError } from "@cloudflare/kv-asset-handler";

const baseHeaders = {
	"X-Content-Type-Options": "nosniff",
	"X-Frame-Options": "DENY",
	"Content-Security-Policy": "default-src 'self'",
	"X-XSS-Protection": "1; mode=block",
	"Cache-Control": "max-age=600",
};

const staticCacheControl = {
	browserTTL: 2 * 60 * 60 * 24,
	edgeTTL: 2 * 60 * 60 * 24,
	bypassCache: false,
};

init();

addEventListener("fetch", (event) => {
	event.respondWith(handle(event));
});

async function handle(event) {
	// try static files first
	if (event.request.method == "GET") {
		try {
			// TODO rather than attempting to get an asset,
			// use the asset manifest to see if it exists
			const response = await getAssetFromKV(event, { cacheControl: staticCacheControl });
			const newResponse = new Response(response.body, { 
				...response, 
				headers: makeHeaders(baseHeaders, new Headers(response.headers)) 
			});
			return newResponse;
		} catch (e) {
			if (!(e instanceof NotFoundError)) {
				return new Response("Error loading static asset:" + (e.message || e.toString()), {
					status: 500
				});
			}
		}
	}

	// fall back to an app route
	const request = event.request;
	const request_url = new URL(request.url);

	try {
		const rendered = await render({
			host: request_url.host,
			path: request_url.pathname,
			query: request_url.searchParams,
			rawBody: await read(request),
			headers: Object.fromEntries(request.headers),
			method: request.method
		});

		if (rendered) {
			return new Response(rendered.body, {
				status: rendered.status,
				headers: makeHeaders({ ...baseHeaders, ...rendered.headers })
			});
		}
	} catch (e) {
		return new Response("Error rendering route:" + (e.message || e.toString()), {
			status: 500, headers: makeHeaders({ ...baseHeaders, "Cache-Control": "no-cache" })
		});
	}

	return new Response({
		status: 404,
		statusText: "Not Found",
		headers: makeHeaders({ ...baseHeaders, "Cache-Control": "no-cache" })
	});
}

/** @param {Request} request */
async function read(request) {
	return new Uint8Array(await request.arrayBuffer());
}

/**
 * @param {Record<string, string | string[]>} headers
 * @returns {Request}
 */
function makeHeaders(headers, result = new Headers()) {
	for (const header in headers) {
		const value = headers[header];
		if (typeof value === "string") {
			result.set(header, value);
			continue;
		}
		for (const sub of value) {
			result.append(header, sub);
		}
	}
	return result;
}