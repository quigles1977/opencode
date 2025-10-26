import type { PerplexityCitation } from "./types"

// Normalize URL for comparison
export function normalizeCitationUrl(url: string): string {
	try {
		const parsed = new URL(url)

		// Remove common tracking parameters
		const trackingParams = [
			"utm_source",
			"utm_medium",
			"utm_campaign",
			"utm_content",
			"utm_term",
			"fbclid",
			"gclid",
			"ref",
			"source",
		]

		for (const param of trackingParams) {
			parsed.searchParams.delete(param)
		}

		// Remove trailing slashes (including multiple)
		let pathname = parsed.pathname
		while (pathname.endsWith("/") && pathname.length > 1) {
			pathname = pathname.slice(0, -1)
		}

		// Remove www prefix for comparison
		let hostname = parsed.hostname
		if (hostname.startsWith("www.")) {
			hostname = hostname.slice(4)
		}

		// Sort search params for consistent comparison
		const sortedParams = new URLSearchParams(
			Array.from(parsed.searchParams.entries()).sort((a, b) => a[0].localeCompare(b[0])),
		)

		// Build normalized URL (lowercase, no hash)
		const normalized = `${parsed.protocol}//${hostname}${pathname}${sortedParams.toString() ? "?" + sortedParams.toString() : ""}`
		return normalized.toLowerCase()
	} catch {
		// If URL parsing fails, return original
		return url
	}
}

export function deduplicateCitations(citations: PerplexityCitation[]): PerplexityCitation[] {
	const seen = new Map<string, PerplexityCitation>()

	for (const citation of citations) {
		const normalized = normalizeCitationUrl(citation.url)

		if (!seen.has(normalized)) {
			seen.set(normalized, citation)
		} else {
			// Keep the citation with more information (e.g., has date)
			const existing = seen.get(normalized)!
			if (citation.date && !existing.date) {
				seen.set(normalized, citation)
			}
		}
	}

	return Array.from(seen.values())
}

// Group citations by domain
export function groupCitationsByDomain(
	citations: PerplexityCitation[],
): Map<string, PerplexityCitation[]> {
	const groups = new Map<string, PerplexityCitation[]>()

	for (const citation of citations) {
		try {
			const url = new URL(citation.url)
			let domain = url.hostname

			// Remove www prefix
			if (domain.startsWith("www.")) {
				domain = domain.slice(4)
			}

			if (!groups.has(domain)) {
				groups.set(domain, [])
			}
			groups.get(domain)!.push(citation)
		} catch {
			// If URL parsing fails, group under "unknown"
			if (!groups.has("unknown")) {
				groups.set("unknown", [])
			}
			groups.get("unknown")!.push(citation)
		}
	}

	return groups
}
