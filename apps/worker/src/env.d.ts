declare namespace Cloudflare {
	interface Env {
		PLANS: R2Bucket;
		SERVE_FROM_BINDING: string;
	}
}
type Env = Cloudflare.Env;
