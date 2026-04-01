import { createWorkflow, SequenceNodeBuilder, } from '@jshookmcp/extension-sdk/workflow';
const workflowId = 'workflow.challenge-detector.v1';
export default createWorkflow(workflowId, 'Challenge Detector')
    .description('Detects and classifies browser challenges: Cloudflare Turnstile/JS Challenge, hCaptcha, reCAPTCHA, DataDome, Akamai Bot Manager, PerimeterX, Kasada, and custom JS detection scripts — producing a challenge report with bypass difficulty assessment.')
    .tags(['reverse', 'captcha', 'challenge', 'cloudflare', 'antibot', 'detection', 'turnstile', 'mission'])
    .timeoutMs(8 * 60_000)
    .defaultMaxConcurrency(4)
    .buildGraph((ctx) => {
    const prefix = 'workflows.challengeDetector';
    const url = String(ctx.getConfig(`${prefix}.url`, 'https://example.com'));
    const waitUntil = String(ctx.getConfig(`${prefix}.waitUntil`, 'networkidle0'));
    const requestTail = Number(ctx.getConfig(`${prefix}.requestTail`, 50));
    const maxConcurrency = Number(ctx.getConfig(`${prefix}.parallel.maxConcurrency`, 4));
    const challengeProbeScript = `
(function() {
  const challenges = {};
  // Cloudflare
  challenges.cfTurnstile = !!document.querySelector('[data-sitekey]') || !!document.querySelector('.cf-turnstile');
  challenges.cfChallenge = !!document.querySelector('#cf-challenge-running') || !!document.getElementById('challenge-form');
  challenges.cfRay = document.querySelector('meta[name="cf-ray"]')?.content || null;
  // reCAPTCHA
  challenges.recaptcha = !!document.querySelector('.g-recaptcha') || !!document.querySelector('[data-sitekey]');
  challenges.recaptchaV3 = typeof grecaptcha !== 'undefined';
  // hCaptcha
  challenges.hcaptcha = !!document.querySelector('.h-captcha') || !!document.querySelector('[data-hcaptcha-widget-id]');
  // DataDome
  challenges.datadome = !!document.querySelector('[data-dd]') || document.cookie.includes('datadome');
  // Akamai Bot Manager
  challenges.akamai = !!document.querySelector('script[src*="akamai"]') || !!document.querySelector('script[src*="bm/"]');
  // PerimeterX / HUMAN
  challenges.perimeterx = !!document.querySelector('script[src*="px"]') || !!window._pxUuid;
  // Kasada
  challenges.kasada = !!document.querySelector('script[src*="ips.js"]') || !!window.__kasada;
  // Generic JS challenge signals
  challenges.hasIframeChallenge = !!document.querySelector('iframe[src*="challenge"]');
  challenges.hasNoscript = !!document.querySelector('noscript');
  challenges.httpStatus = document.querySelector('meta[http-equiv="status"]')?.content || null;
  challenges.title = document.title;
  challenges.bodyTextLength = document.body?.innerText?.length || 0;
  return challenges;
})()`;
    const root = new SequenceNodeBuilder('challenge-detector-root');
    root
        // Phase 1: Network & Navigate
        .tool('enable-network', 'network_enable', { input: { enableExceptions: true } })
        .tool('navigate', 'page_navigate', { input: { url, waitUntil } })
        // Phase 2: Challenge Probe
        .tool('probe-challenges', 'page_evaluate', {
        input: { expression: challengeProbeScript },
    })
        // Phase 3: Parallel Analysis
        .parallel('analyse-challenges', (p) => {
        p.maxConcurrency(maxConcurrency)
            .failFast(false)
            .tool('get-requests', 'network_get_requests', { input: { tail: requestTail } })
            .tool('captcha-detect', 'captcha_detect', { input: {} })
            .tool('search-challenge-scripts', 'search_in_scripts', {
            input: { query: 'challenge,captcha,turnstile,datadome,akamai,perimeterx,kasada,botmanager', matchType: 'any' },
        })
            .tool('screenshot', 'page_screenshot', { input: { fullPage: true } })
            .tool('detect-obfuscation', 'detect_obfuscation', { input: {} })
            .tool('stealth-verify', 'stealth_verify', { input: { categories: 'webdriver,navigator,timing,canvas' } });
    })
        // Phase 4: Response Analysis
        .tool('get-network-stats', 'network_get_stats', { input: {} })
        .tool('get-cookies', 'page_get_cookies')
        // Phase 5: Evidence Recording
        .tool('create-evidence-session', 'instrumentation_session_create', {
        input: {
            name: `challenge-detection-${new Date().toISOString().slice(0, 10)}`,
            metadata: { url, workflowId },
        },
    })
        .tool('record-artifact', 'instrumentation_artifact_record', {
        input: {
            type: 'challenge_detection_report',
            label: `Challenge detection for ${url}`,
            metadata: { url },
        },
    })
        // Phase 6: Session Insight
        .tool('emit-insight', 'append_session_insight', {
        input: {
            insight: JSON.stringify({
                status: 'challenge_detector_complete',
                workflowId,
                url,
            }),
        },
    });
    return root;
})
    .onStart((ctx) => {
    ctx.emitMetric('workflow_runs_total', 1, 'counter', { workflowId, mission: 'challenge_detector', stage: 'start' });
})
    .onFinish((ctx) => {
    ctx.emitMetric('workflow_runs_total', 1, 'counter', { workflowId, mission: 'challenge_detector', stage: 'finish' });
})
    .onError((ctx, error) => {
    ctx.emitMetric('workflow_errors_total', 1, 'counter', { workflowId, mission: 'challenge_detector', stage: 'error', error: error.name });
})
    .build();
