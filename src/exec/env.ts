export const NO_PROXY_VALUE =
  "localhost,127.0.0.1,::1,*.local,.local,169.254.0.0/16,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16";

export function buildProxyEnv(proxyUrl?: string, socksProxyUrl?: string): Record<string, string> {
  const env: Record<string, string> = {
    NO_PROXY: NO_PROXY_VALUE,
    no_proxy: NO_PROXY_VALUE,
  };
  if (proxyUrl) {
    env.HTTP_PROXY = proxyUrl;
    env.HTTPS_PROXY = proxyUrl;
    env.http_proxy = proxyUrl;
    env.https_proxy = proxyUrl;
  }
  if (socksProxyUrl) {
    env.ALL_PROXY = socksProxyUrl;
    env.all_proxy = socksProxyUrl;
    env.FTP_PROXY = socksProxyUrl;
    env.ftp_proxy = socksProxyUrl;
    env.RSYNC_PROXY = socksProxyUrl.replace(/^socks5h:\/\//, "");
    env.GRPC_PROXY = socksProxyUrl;
    env.grpc_proxy = socksProxyUrl;
    const socksHostPort = socksProxyUrl.replace(/^socks5h:\/\//, "").replace(":", " ");
    env.GIT_SSH_COMMAND = `ssh -o ProxyCommand='nc -X 5 -x ${socksHostPort} %h %p'`;
  }
  if (proxyUrl || socksProxyUrl) {
    const dockerProxy = proxyUrl ?? socksProxyUrl;
    if (dockerProxy) {
      env.DOCKER_HTTP_PROXY = dockerProxy;
      env.DOCKER_HTTPS_PROXY = dockerProxy;
    }
  }
  return env;
}
