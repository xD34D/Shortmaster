import { i as __toESM } from "../_runtime.mjs";
import { a as require_jsx_runtime, o as require_react } from "../_libs/@radix-ui/react-collection+[...].mjs";
import { i as Download, n as Play, r as Pause } from "../_libs/lucide-react.mjs";
import { i as SliderTrack, n as SliderRange, r as SliderThumb, t as Slider } from "../_libs/@radix-ui/react-slider+[...].mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/routes-Q7CHhozZ.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var MAX_AUDIO_BYTES = 94371840;
function normalize(values) {
	if (values.length === 0) return values;
	const sorted = [...values].sort((a, b) => a - b);
	const index = Math.min(sorted.length - 1, Math.floor(sorted.length * .95));
	const cap = Math.max(sorted[index] ?? 0, 8e-4);
	return values.map((value) => Math.min(1, value / cap));
}
function waitFor(target, event, signal, ms) {
	return new Promise((resolve, reject) => {
		const timer = window.setTimeout(() => {
			cleanup();
			reject(/* @__PURE__ */ new Error("TIMEOUT"));
		}, ms);
		const onAbort = () => {
			cleanup();
			reject(new DOMException("Aborted", "AbortError"));
		};
		const onEvent = () => {
			cleanup();
			resolve();
		};
		const onError = () => {
			cleanup();
			reject(/* @__PURE__ */ new Error("UNREADABLE"));
		};
		function cleanup() {
			window.clearTimeout(timer);
			target.removeEventListener(event, onEvent);
			target.removeEventListener("error", onError);
			signal.removeEventListener("abort", onAbort);
		}
		signal.addEventListener("abort", onAbort);
		target.addEventListener(event, onEvent);
		target.addEventListener("error", onError);
	});
}
function seekTo(video, time, signal) {
	return new Promise((resolve, reject) => {
		const timer = window.setTimeout(() => {
			cleanup();
			resolve();
		}, 2200);
		const onAbort = () => {
			cleanup();
			reject(new DOMException("Aborted", "AbortError"));
		};
		const onSeeked = () => {
			cleanup();
			resolve();
		};
		function cleanup() {
			window.clearTimeout(timer);
			video.removeEventListener("seeked", onSeeked);
			signal.removeEventListener("abort", onAbort);
		}
		signal.addEventListener("abort", onAbort);
		video.addEventListener("seeked", onSeeked);
		if (Math.abs(video.currentTime - time) < .04 && video.readyState >= 2) {
			cleanup();
			resolve();
			return;
		}
		try {
			video.currentTime = time;
		} catch {
			cleanup();
			resolve();
		}
	});
}
async function decodeAudio(file, url, signal) {
	try {
		let blob = null;
		if (file) {
			if (file.size > MAX_AUDIO_BYTES) return null;
			blob = file;
		} else {
			const response = await fetch(url, { signal });
			if (!response.ok) return null;
			if (Number(response.headers.get("content-length") || 0) > MAX_AUDIO_BYTES) return null;
			blob = await response.blob();
			if (blob.size > MAX_AUDIO_BYTES) return null;
		}
		const context = new AudioContext();
		try {
			const encoded = await blob.arrayBuffer();
			if (signal.aborted) return null;
			return await context.decodeAudioData(encoded);
		} finally {
			await context.close().catch(() => void 0);
		}
	} catch {
		return null;
	}
}
function rmsAt(buffer, time, windowSec) {
	const rate = buffer.sampleRate;
	const start = Math.max(0, Math.floor(time * rate));
	const end = Math.min(buffer.length, Math.floor((time + windowSec) * rate));
	if (end <= start) return 0;
	const step = Math.max(1, Math.floor((end - start) / 480));
	let energy = 0;
	let count = 0;
	const channels = Math.min(2, buffer.numberOfChannels);
	for (let channel = 0; channel < channels; channel++) {
		const data = buffer.getChannelData(channel);
		for (let index = start; index < end; index += step) {
			const value = data[index] ?? 0;
			energy += value * value;
			count += 1;
		}
	}
	return count ? Math.sqrt(energy / count) : 0;
}
function frameDelta(data, previous) {
	if (!previous) return 0;
	let total = 0;
	let count = 0;
	const stride = 16;
	for (let index = 0; index < data.length; index += stride) {
		total += Math.abs(data[index] - previous[index]);
		total += Math.abs(data[index + 1] - previous[index + 1]);
		total += Math.abs(data[index + 2] - previous[index + 2]);
		count += 3;
	}
	return count ? total / (count * 255) : 0;
}
async function analyzeSource(options) {
	const { url, file, signal, onProgress } = options;
	const video = document.createElement("video");
	video.preload = "auto";
	video.muted = true;
	video.playsInline = true;
	video.crossOrigin = url.startsWith("blob:") ? null : "anonymous";
	video.style.cssText = "position:fixed;width:2px;height:2px;opacity:0;pointer-events:none;left:0;top:0";
	document.body.appendChild(video);
	const audioPromise = decodeAudio(file, url, signal);
	try {
		video.src = url;
		await waitFor(video, "loadeddata", signal, 2e4);
		const duration = video.duration;
		if (!Number.isFinite(duration) || duration <= 0) throw new Error("UNREADABLE");
		const width = video.videoWidth;
		const height = video.videoHeight;
		if (!width || !height) throw new Error("UNREADABLE");
		const scale = 96 / Math.max(width, height);
		const canvas = document.createElement("canvas");
		canvas.width = Math.max(2, Math.round(width * scale));
		canvas.height = Math.max(2, Math.round(height * scale));
		const context = canvas.getContext("2d", { willReadFrequently: true });
		if (!context) throw new Error("UNREADABLE");
		const hop = Math.max(.35, duration / 120);
		const times = [];
		for (let time = 0; time < duration - .05; time += hop) times.push(time);
		if (times.length === 0) times.push(0);
		const motion = [];
		let previous = null;
		for (let index = 0; index < times.length; index++) {
			if (signal.aborted) throw new DOMException("Aborted", "AbortError");
			await seekTo(video, Math.min(times[index], Math.max(0, duration - .08)), signal);
			context.drawImage(video, 0, 0, canvas.width, canvas.height);
			let pixels;
			try {
				pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
			} catch {
				throw new Error("PROTECTED");
			}
			motion.push(frameDelta(pixels, previous));
			previous = new Uint8ClampedArray(pixels);
			onProgress((index + 1) / times.length);
		}
		const audioBuffer = await audioPromise;
		const audioNorm = normalize(times.map((time) => audioBuffer ? rmsAt(audioBuffer, time, hop) : 0));
		const motionNorm = normalize(motion);
		return {
			samples: times.map((time, index) => ({
				t: time,
				audio: audioNorm[index] ?? 0,
				motion: motionNorm[index] ?? 0
			})),
			duration,
			width,
			height,
			audio: audioBuffer ? "full" : "missing"
		};
	} finally {
		video.pause();
		video.removeAttribute("src");
		video.load();
		video.remove();
	}
}
function formatClock(seconds) {
	if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
	const total = Math.round(seconds);
	return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, "0")}`;
}
function formatSpan(start, end) {
	return `${formatClock(start)} – ${formatClock(end)}`;
}
var YOUTUBE = /* @__PURE__ */ new Set([
	"youtube.com",
	"youtu.be",
	"m.youtube.com",
	"music.youtube.com",
	"youtube-nocookie.com"
]);
var SOCIAL = /* @__PURE__ */ new Set([
	"instagram.com",
	"tiktok.com",
	"vm.tiktok.com",
	"vimeo.com",
	"facebook.com",
	"fb.watch",
	"x.com",
	"twitter.com",
	"dailymotion.com"
]);
function classifyLink(raw) {
	let url;
	try {
		url = new URL(raw.trim());
	} catch {
		return "bad";
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") return "bad";
	const host = url.hostname.replace(/^www\./, "").toLowerCase();
	if (YOUTUBE.has(host)) return "youtube";
	if (SOCIAL.has(host)) return "social";
	return "direct";
}
function clamp(n, min, max) {
	return Math.min(max, Math.max(min, n));
}
function extensionForMime(mime) {
	return mime.includes("mp4") ? "mp4" : "webm";
}
function pickRecorderMime() {
	if (typeof MediaRecorder === "undefined") return null;
	return [
		"video/mp4;codecs=avc1.42E01E,mp4a.40.2",
		"video/mp4",
		"video/webm;codecs=vp9,opus",
		"video/webm;codecs=vp8,opus",
		"video/webm"
	].find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}
async function exportShort(options) {
	const mime = pickRecorderMime();
	if (!mime || typeof MediaRecorder === "undefined") throw new Error("NO_RECORDER");
	const { url, start, end, width, height, focusX, focusY, title, fade, signal, onProgress } = options;
	const length = Math.max(.4, end - start);
	const video = document.createElement("video");
	video.preload = "auto";
	video.playsInline = true;
	video.crossOrigin = url.startsWith("blob:") ? null : "anonymous";
	video.style.cssText = "position:fixed;width:2px;height:2px;opacity:0;pointer-events:none;left:0;top:0";
	document.body.appendChild(video);
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext("2d");
	if (!context) {
		video.remove();
		throw new Error("EXPORT");
	}
	let audioContext = null;
	let recorder = null;
	const throwIfAborted = () => {
		if (signal.aborted) throw new DOMException("Aborted", "AbortError");
	};
	try {
		video.src = url;
		await once(video, "loadedmetadata", signal, 2e4);
		throwIfAborted();
		video.currentTime = clamp(start, 0, Math.max(0, video.duration - .05));
		await once(video, "seeked", signal, 8e3);
		const cleanTitle = title.replace(/\s+/g, " ").trim().slice(0, 80);
		if (cleanTitle && document.fonts?.load) {
			const size = Math.round(width * .042);
			await document.fonts.load(`500 ${size}px Outfit`).catch(() => void 0);
		}
		audioContext = new AudioContext();
		await audioContext.resume().catch(() => void 0);
		const source = audioContext.createMediaElementSource(video);
		const destination = audioContext.createMediaStreamDestination();
		source.connect(destination);
		const canvasStream = canvas.captureStream(30);
		const stream = new MediaStream([...canvasStream.getVideoTracks(), ...destination.stream.getAudioTracks()]);
		drawFrame(context, video, {
			width,
			height,
			focusX,
			focusY,
			title: cleanTitle,
			alpha: fade ? 0 : 1
		});
		const chunks = [];
		try {
			recorder = new MediaRecorder(stream, {
				mimeType: mime,
				videoBitsPerSecond: width >= 1080 ? 7e6 : 42e5,
				audioBitsPerSecond: 128e3
			});
		} catch {
			recorder = new MediaRecorder(stream, { mimeType: mime });
		}
		recorder.addEventListener("dataavailable", (event) => {
			if (event.data.size > 0) chunks.push(event.data);
		});
		const stopped = once(recorder, "stop", signal, length * 1e3 + 2e4).catch(() => void 0);
		recorder.start(250);
		try {
			await video.play();
		} catch {
			throw new Error("EXPORT");
		}
		const startedAt = performance.now();
		await new Promise((resolve, reject) => {
			const step = () => {
				if (signal.aborted) {
					reject(new DOMException("Aborted", "AbortError"));
					return;
				}
				const rel = video.currentTime - start;
				const alpha = fade ? fadeAlpha(rel, length) : 1;
				drawFrame(context, video, {
					width,
					height,
					focusX,
					focusY,
					title: cleanTitle,
					alpha
				});
				onProgress(clamp(rel / length, 0, 1));
				if (performance.now() - startedAt > length * 1e3 + 8e3 || video.ended || video.currentTime >= end - .04) {
					resolve();
					return;
				}
				requestAnimationFrame(step);
			};
			requestAnimationFrame(step);
		});
		video.pause();
		drawFrame(context, video, {
			width,
			height,
			focusX,
			focusY,
			title: cleanTitle,
			alpha: fade ? 0 : 1
		});
		await new Promise((resolve) => window.setTimeout(resolve, 120));
		if (recorder.state !== "inactive") recorder.stop();
		await stopped.catch(() => void 0);
		onProgress(1);
		const type = recorder.mimeType || mime;
		const blob = new Blob(chunks, { type });
		if (blob.size < 800) throw new Error("EXPORT");
		return {
			blob,
			mime: type
		};
	} finally {
		if (recorder && recorder.state !== "inactive") try {
			recorder.stop();
		} catch {}
		video.pause();
		video.removeAttribute("src");
		video.load();
		video.remove();
		await audioContext?.close().catch(() => void 0);
	}
}
function fadeAlpha(rel, length) {
	const fadeIn = .35;
	const fadeOut = .5;
	let alpha = 1;
	if (rel < fadeIn) alpha = Math.max(0, rel / fadeIn);
	const remaining = length - rel;
	if (remaining < fadeOut) alpha = Math.min(alpha, Math.max(0, remaining / fadeOut));
	return alpha;
}
function drawFrame(context, video, frame) {
	const { width, height, focusX, focusY, title, alpha } = frame;
	context.filter = "none";
	context.globalAlpha = 1;
	context.fillStyle = "#16130f";
	context.fillRect(0, 0, width, height);
	if (video.videoWidth > 0 && alpha > .001) {
		const scale = Math.max(width / video.videoWidth, height / video.videoHeight);
		const drawnW = video.videoWidth * scale;
		const drawnH = video.videoHeight * scale;
		const x = (width - drawnW) * focusX;
		const y = (height - drawnH) * focusY;
		context.filter = "contrast(1.04) saturate(0.95)";
		context.globalAlpha = alpha;
		context.drawImage(video, x, y, drawnW, drawnH);
		context.filter = "none";
		context.globalAlpha = 1;
	}
	if (title && alpha > .4) drawTitle(context, title, width, height, alpha);
}
function drawTitle(context, title, width, height, alpha) {
	const pad = Math.round(width * .08);
	const size = Math.max(18, Math.round(width * .042));
	const maxWidth = width - pad * 2;
	context.globalAlpha = alpha;
	context.font = `500 ${size}px Outfit, sans-serif`;
	context.textBaseline = "top";
	context.textAlign = "left";
	const lines = wrap(context, title, maxWidth).slice(0, 2);
	const y = Math.round(height * .7);
	context.fillStyle = "#8d5a2b";
	context.fillRect(pad, y - Math.round(size * .55), Math.round(width * .11), Math.max(2, Math.round(width * .004)));
	context.fillStyle = "#f4efe6";
	lines.forEach((line, index) => {
		context.fillText(line, pad, y + index * (size * 1.25));
	});
	context.globalAlpha = 1;
}
function wrap(context, text, maxWidth) {
	const words = text.split(" ");
	const lines = [];
	let current = "";
	for (const word of words) {
		const next = current ? `${current} ${word}` : word;
		if (context.measureText(next).width > maxWidth && current) {
			lines.push(current);
			current = word;
		} else current = next;
	}
	if (current) lines.push(current);
	return lines;
}
function once(target, event, signal, ms) {
	return new Promise((resolve, reject) => {
		const timer = window.setTimeout(() => {
			cleanup();
			resolve();
		}, ms);
		const onAbort = () => {
			cleanup();
			reject(new DOMException("Aborted", "AbortError"));
		};
		const onEvent = () => {
			cleanup();
			resolve();
		};
		function cleanup() {
			window.clearTimeout(timer);
			target.removeEventListener(event, onEvent);
			signal.removeEventListener("abort", onAbort);
		}
		signal.addEventListener("abort", onAbort);
		target.addEventListener(event, onEvent, { once: true });
	});
}
function lowerBound(samples, t) {
	let lo = 0;
	let hi = samples.length;
	while (lo < hi) {
		const mid = lo + hi >> 1;
		if (samples[mid].t < t) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}
function reasonsFor(audio, motion, hook) {
	const reasons = [];
	if (audio >= .42 && motion >= .42) reasons.push("Suono e movimento insieme");
	else if (audio >= motion && audio >= .38) reasons.push("Audio pieno");
	else if (motion > audio && motion >= .38) reasons.push("Movimento deciso");
	else if (hook >= .4) reasons.push("Apertura più viva");
	else reasons.push("Passaggio più presente");
	if (hook >= .55 && reasons.length < 2) reasons.push("Attacco nitido");
	return reasons.slice(0, 2);
}
function selectShorts(samples, duration, target, limit, mode) {
	if (!Number.isFinite(duration) || duration <= .2) return [];
	const length = Math.min(Math.max(target, 1), duration);
	if (duration <= target + .35 || samples.length === 0) return [{
		id: "intero",
		start: 0,
		end: duration,
		score: 1,
		peak: clamp(samples.reduce((best, sample) => {
			const v = sample.audio * .6 + sample.motion * .4;
			return v > best.v ? {
				t: sample.t,
				v
			} : best;
		}, {
			t: Math.min(1, duration / 2),
			v: -1
		}).t, 0, Math.max(0, duration - .05)),
		reasons: [duration + .2 < target ? "Video più corto del formato" : "Video intero"]
	}];
	const audioPrefix = new Float64Array(samples.length + 1);
	const motionPrefix = new Float64Array(samples.length + 1);
	const energyPrefix = new Float64Array(samples.length + 1);
	for (let i = 0; i < samples.length; i++) {
		const sample = samples[i];
		audioPrefix[i + 1] = audioPrefix[i] + sample.audio;
		motionPrefix[i + 1] = motionPrefix[i] + sample.motion;
		energyPrefix[i + 1] = energyPrefix[i] + sample.audio * .6 + sample.motion * .4;
	}
	const mean = (prefix, lo, hi) => {
		const n = hi - lo;
		if (n <= 0) return 0;
		return (prefix[hi] - prefix[lo]) / n;
	};
	const peakAt = (lo, hi, fallback) => {
		let bestT = fallback;
		let bestV = -1;
		for (let i = lo; i < hi; i++) {
			const sample = samples[i];
			const v = sample.audio * .6 + sample.motion * .4;
			if (v > bestV) {
				bestV = v;
				bestT = sample.t;
			}
		}
		return bestT;
	};
	const scoreAt = (start) => {
		const end = start + length;
		const lo = lowerBound(samples, start);
		const hi = lowerBound(samples, end);
		const audio = mean(audioPrefix, lo, hi);
		const motion = mean(motionPrefix, lo, hi);
		const hookHi = lowerBound(samples, start + Math.min(4, length * .12));
		const hook = mean(energyPrefix, lo, Math.max(lo + 1, hookHi));
		let quiet = 0;
		const n = Math.max(1, hi - lo);
		for (let i = lo; i < hi; i++) {
			const sample = samples[i];
			if (sample.audio < .1 && sample.motion < .1) quiet += 1;
		}
		return {
			start,
			end,
			score: Math.max(0, audio * .5 + motion * .34 + hook * .16 - quiet / n * .2),
			peak: clamp(peakAt(lo, hi, start + length * .35), start, end),
			reasons: reasonsFor(audio, motion, hook)
		};
	};
	const last = duration - length;
	const step = Math.min(1, Math.max(.35, length / 48));
	const seen = /* @__PURE__ */ new Set();
	const starts = [];
	const pushStart = (value) => {
		const start = clamp(value, 0, last);
		const key = Math.round(start * 20);
		if (seen.has(key)) return;
		seen.add(key);
		starts.push(start);
	};
	for (let start = 0; start <= last + .001; start += step) pushStart(start);
	pushStart(last);
	let globalPeak = 0;
	let globalV = -1;
	for (const sample of samples) {
		const v = sample.audio * .6 + sample.motion * .4;
		if (v > globalV) {
			globalV = v;
			globalPeak = sample.t;
		}
	}
	pushStart(globalPeak - length * .35);
	const ranked = starts.map(scoreAt).sort((a, b) => b.score - a.score);
	const cap = Math.max(1, Math.min(4, limit));
	const picked = [];
	for (const window of ranked) {
		if (picked.length >= cap) break;
		if (!picked.some((other) => {
			return Math.min(window.end, other.end) - Math.max(window.start, other.start) > .35;
		})) picked.push(window);
	}
	if (picked.length === 0 && ranked[0]) picked.push(ranked[0]);
	let chosen = picked;
	if (mode === "auto" && chosen.length > 1) {
		const floor = chosen[0].score * .62;
		const strong = chosen.filter((window) => window.score >= floor);
		if (strong.length > 0) chosen = strong;
	}
	chosen.sort((a, b) => a.start - b.start);
	return chosen.map((window, index) => ({
		id: `c${index}-${Math.round(window.start * 10)}`,
		start: window.start,
		end: window.end,
		score: window.score,
		peak: window.peak,
		reasons: window.reasons
	}));
}
var DEFAULT_SETTINGS = {
	durationSec: 60,
	countMode: "auto",
	aspect: "9:16",
	focusX: .5,
	focusY: .42,
	title: "",
	quality: "720",
	guides: true,
	fade: true
};
function outputSize(aspect, quality) {
	const short = quality === "1080" ? 1080 : 720;
	const long = quality === "1080" ? 1920 : 1280;
	if (aspect === "1:1") return {
		width: short,
		height: short
	};
	if (aspect === "4:5") return {
		width: short,
		height: Math.round(short * 5 / 4)
	};
	return {
		width: short,
		height: long
	};
}
function aspectLabel(aspect) {
	if (aspect === "1:1") return "1:1";
	if (aspect === "4:5") return "4:5";
	return "9:16";
}
function Timeline({ duration, samples, clips, activeId, currentTime, onSeek, onShift }) {
	const canvasRef = (0, import_react.useRef)(null);
	const dragRef = (0, import_react.useRef)(null);
	(0, import_react.useEffect)(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const parent = canvas.parentElement;
		if (!parent) return;
		const draw = () => {
			const cssWidth = parent.clientWidth;
			const cssHeight = 88;
			const ratio = window.devicePixelRatio || 1;
			canvas.width = Math.max(1, Math.round(cssWidth * ratio));
			canvas.height = Math.round(cssHeight * ratio);
			canvas.style.width = `${cssWidth}px`;
			canvas.style.height = `${cssHeight}px`;
			const context = canvas.getContext("2d");
			if (!context || duration <= 0) return;
			context.setTransform(ratio, 0, 0, ratio, 0, 0);
			context.clearRect(0, 0, cssWidth, cssHeight);
			context.fillStyle = "#faf6ef";
			context.fillRect(0, 0, cssWidth, cssHeight);
			const bars = Math.max(40, Math.round(cssWidth / 5));
			const gap = 1;
			const barW = cssWidth / bars;
			for (let index = 0; index < bars; index++) {
				const a = index / bars * duration;
				const b = (index + 1) / bars * duration;
				let energy = 0;
				let count = 0;
				for (const sample of samples) {
					if (sample.t < a) continue;
					if (sample.t >= b) break;
					energy += sample.audio * .58 + sample.motion * .42;
					count += 1;
				}
				const value = count ? energy / count : 0;
				const h = Math.max(2, value * 62);
				context.fillStyle = value > .55 ? "#8d5a2b" : "rgba(28,23,18,0.18)";
				context.fillRect(index * barW + gap / 2, 74 - h, Math.max(1, barW - gap), h);
			}
			for (const clip of clips) {
				const x = clip.start / duration * cssWidth;
				const w = (clip.end - clip.start) / duration * cssWidth;
				const active = clip.id === activeId;
				context.fillStyle = active ? "rgba(141,90,43,0.16)" : "rgba(28,23,18,0.05)";
				context.fillRect(x, 6, w, 76);
				context.strokeStyle = active ? "#8d5a2b" : "rgba(28,23,18,0.28)";
				context.lineWidth = active ? 1.5 : 1;
				context.strokeRect(x + .5, 6.5, Math.max(0, w - 1), 75);
			}
			const playhead = currentTime / duration * cssWidth;
			context.fillStyle = "#1c1712";
			context.fillRect(playhead - .75, 0, 1.5, cssHeight);
		};
		draw();
		const observer = new ResizeObserver(draw);
		observer.observe(parent);
		return () => observer.disconnect();
	}, [
		activeId,
		clips,
		currentTime,
		duration,
		samples
	]);
	const timeAt = (clientX) => {
		const canvas = canvasRef.current;
		if (!canvas || duration <= 0) return 0;
		const rect = canvas.getBoundingClientRect();
		return clamp((clientX - rect.left) / rect.width * duration, 0, duration);
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("canvas", {
		ref: canvasRef,
		role: "slider",
		tabIndex: 0,
		"aria-label": "Linea del tempo e momenti scelti",
		"aria-valuemin": 0,
		"aria-valuemax": Math.round(duration),
		"aria-valuenow": Math.round(currentTime),
		className: "block w-full touch-none rounded-2xl bg-sheet",
		onKeyDown: (event) => {
			if (event.key === "ArrowLeft") {
				event.preventDefault();
				onSeek(clamp(currentTime - 1, 0, duration));
			}
			if (event.key === "ArrowRight") {
				event.preventDefault();
				onSeek(clamp(currentTime + 1, 0, duration));
			}
		},
		onPointerDown: (event) => {
			const time = timeAt(event.clientX);
			const hit = clips.find((clip) => clip.id === activeId && time >= clip.start && time <= clip.end) ?? clips.find((clip) => time >= clip.start && time <= clip.end) ?? null;
			dragRef.current = {
				pointer: event.clientX,
				time,
				id: hit?.id ?? null,
				origin: hit?.start ?? 0,
				moved: false
			};
			event.currentTarget.setPointerCapture(event.pointerId);
		},
		onPointerMove: (event) => {
			const drag = dragRef.current;
			if (!drag?.id) return;
			if (Math.abs(event.clientX - drag.pointer) < 4) return;
			drag.moved = true;
			const delta = timeAt(event.clientX) - drag.time;
			onShift(drag.id, drag.origin + delta);
		},
		onPointerUp: (event) => {
			const drag = dragRef.current;
			dragRef.current = null;
			if (!drag || !drag.moved) onSeek(timeAt(event.clientX));
		}
	});
}
var STORAGE_KEY = "corto-settings";
function sanitize(value) {
	const next = {};
	if (typeof value.durationSec === "number" && Number.isFinite(value.durationSec)) next.durationSec = clamp(Math.round(value.durationSec), 10, 90);
	if (value.countMode === "auto" || value.countMode === 1 || value.countMode === 2 || value.countMode === 3 || value.countMode === 4) next.countMode = value.countMode;
	if (value.aspect === "9:16" || value.aspect === "4:5" || value.aspect === "1:1") next.aspect = value.aspect;
	if (typeof value.focusX === "number") next.focusX = clamp(value.focusX, 0, 1);
	if (typeof value.focusY === "number") next.focusY = clamp(value.focusY, 0, 1);
	if (typeof value.title === "string") next.title = value.title.slice(0, 80);
	if (value.quality === "720" || value.quality === "1080") next.quality = value.quality;
	if (typeof value.guides === "boolean") next.guides = value.guides;
	if (typeof value.fade === "boolean") next.fade = value.fade;
	return next;
}
function explain(error) {
	if (error instanceof DOMException && error.name === "AbortError") return null;
	const code = error instanceof Error ? error.message : "";
	if (code === "PROTECTED") return "Questo server non lascia leggere i fotogrammi. Scarica il file e caricalo dal dispositivo.";
	if (code === "TIMEOUT") return "Il video ha impiegato troppo a rispondere. Riprova o carica il file.";
	if (code === "UNREADABLE") return "Non riesco a leggere questo video. Usa mp4 o webm, oppure un link diretto al file.";
	if (code === "NO_RECORDER") return "Questo browser non può creare il file. Apri Corto con Chrome, Edge o Firefox.";
	if (code === "EXPORT") return "L'esportazione si è interrotta. Riprova e tieni la pagina aperta.";
	return "Non sono riuscito a completare l'operazione. Riprova.";
}
function saveFile(blob, filename) {
	const href = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = href;
	link.download = filename;
	link.click();
	window.setTimeout(() => URL.revokeObjectURL(href), 4e3);
}
function Studio() {
	const [settings, setSettings] = (0, import_react.useState)(DEFAULT_SETTINGS);
	const [link, setLink] = (0, import_react.useState)("");
	const [over, setOver] = (0, import_react.useState)(false);
	const [error, setError] = (0, import_react.useState)(null);
	const [phase, setPhase] = (0, import_react.useState)("empty");
	const [progress, setProgress] = (0, import_react.useState)(0);
	const [sourceUrl, setSourceUrl] = (0, import_react.useState)(null);
	const [sourceName, setSourceName] = (0, import_react.useState)("");
	const [samples, setSamples] = (0, import_react.useState)([]);
	const [duration, setDuration] = (0, import_react.useState)(0);
	const [mediaSize, setMediaSize] = (0, import_react.useState)(null);
	const [audioMode, setAudioMode] = (0, import_react.useState)("full");
	const [clips, setClips] = (0, import_react.useState)([]);
	const [activeId, setActiveId] = (0, import_react.useState)(null);
	const [thumbs, setThumbs] = (0, import_react.useState)({});
	const [time, setTime] = (0, import_react.useState)(0);
	const [playing, setPlaying] = (0, import_react.useState)(false);
	const [reelPlaying, setReelPlaying] = (0, import_react.useState)(false);
	const [exporting, setExporting] = (0, import_react.useState)(null);
	const fileRef = (0, import_react.useRef)(null);
	const stageRef = (0, import_react.useRef)(null);
	const phoneRef = (0, import_react.useRef)(null);
	const ownedUrl = (0, import_react.useRef)(null);
	const jobRef = (0, import_react.useRef)(0);
	const abortRef = (0, import_react.useRef)(null);
	const exportAbort = (0, import_react.useRef)(null);
	const exportLock = (0, import_react.useRef)(false);
	const clipsRef = (0, import_react.useRef)(clips);
	clipsRef.current = clips;
	const limit = settings.countMode === "auto" ? 3 : settings.countMode;
	const mode = settings.countMode === "auto" ? "auto" : "fixed";
	const suggested = (0, import_react.useMemo)(() => {
		if (samples.length === 0 || duration <= 0) return [];
		return selectShorts(samples, duration, settings.durationSec, limit, mode);
	}, [
		duration,
		limit,
		mode,
		samples,
		settings.durationSec
	]);
	(0, import_react.useEffect)(() => {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (!raw) return;
			const parsed = sanitize(JSON.parse(raw));
			setSettings((current) => ({
				...current,
				...parsed
			}));
		} catch {}
	}, []);
	(0, import_react.useEffect)(() => {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
		} catch {}
	}, [settings]);
	(0, import_react.useEffect)(() => {
		setClips(suggested);
		setActiveId((current) => current && suggested.some((clip) => clip.id === current) ? current : suggested[0]?.id ?? null);
	}, [suggested]);
	(0, import_react.useEffect)(() => {
		return () => {
			abortRef.current?.abort();
			exportAbort.current?.abort();
			if (ownedUrl.current) URL.revokeObjectURL(ownedUrl.current);
		};
	}, []);
	const thumbKey = clips.map((clip) => `${clip.id}:${Math.round(clip.start * 2)}:${Math.round(clip.peak * 2)}`).join("|");
	(0, import_react.useEffect)(() => {
		if (!sourceUrl || clipsRef.current.length === 0) return;
		let cancel = false;
		const timer = window.setTimeout(() => {
			const video = document.createElement("video");
			video.muted = true;
			video.playsInline = true;
			video.preload = "auto";
			if (!sourceUrl.startsWith("blob:")) video.crossOrigin = "anonymous";
			video.src = sourceUrl;
			const canvas = document.createElement("canvas");
			canvas.width = 180;
			canvas.height = settings.aspect === "1:1" ? 180 : settings.aspect === "4:5" ? 225 : 320;
			const paint = async () => {
				try {
					await new Promise((resolve, reject) => {
						const ok = () => {
							video.removeEventListener("loadeddata", ok);
							resolve();
						};
						const bad = () => {
							video.removeEventListener("error", bad);
							reject(/* @__PURE__ */ new Error("thumb"));
						};
						video.addEventListener("loadeddata", ok, { once: true });
						video.addEventListener("error", bad, { once: true });
					});
				} catch {
					return;
				}
				for (const clip of clipsRef.current) {
					if (cancel) return;
					const at = clip.peak >= clip.start && clip.peak <= clip.end ? clip.peak : clip.start + (clip.end - clip.start) * .35;
					video.currentTime = clamp(at, 0, Math.max(0, (video.duration || at) - .05));
					await new Promise((resolve) => {
						const done = () => {
							video.removeEventListener("seeked", done);
							resolve();
						};
						video.addEventListener("seeked", done);
						window.setTimeout(done, 1200);
					});
					if (cancel || !video.videoWidth) continue;
					const context = canvas.getContext("2d");
					if (!context) continue;
					context.fillStyle = "#16130f";
					context.fillRect(0, 0, canvas.width, canvas.height);
					const scale = Math.max(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
					const drawnW = video.videoWidth * scale;
					const drawnH = video.videoHeight * scale;
					context.drawImage(video, (canvas.width - drawnW) * settings.focusX, (canvas.height - drawnH) * settings.focusY, drawnW, drawnH);
					try {
						const pic = canvas.toDataURL("image/jpeg", .74);
						if (!cancel) setThumbs((current) => ({
							...current,
							[clip.id]: pic
						}));
					} catch {}
				}
				video.pause();
				video.removeAttribute("src");
				video.load();
			};
			paint();
		}, 280);
		return () => {
			cancel = true;
			window.clearTimeout(timer);
		};
	}, [
		settings.aspect,
		settings.focusX,
		settings.focusY,
		sourceUrl,
		thumbKey
	]);
	const active = clips.find((clip) => clip.id === activeId) ?? clips[0] ?? null;
	const wide = !!mediaSize && mediaSize.w / Math.max(1, mediaSize.h) > 1.15 && settings.aspect !== "1:1";
	const tuned = clips.some((clip, index) => {
		const origin = suggested[index];
		return !origin || Math.abs(origin.start - clip.start) > .2 || clip.tuned;
	});
	function update(patch) {
		setSettings((current) => ({
			...current,
			...patch
		}));
	}
	function adoptUrl(url, owned) {
		if (ownedUrl.current && ownedUrl.current !== url) URL.revokeObjectURL(ownedUrl.current);
		ownedUrl.current = owned ? url : null;
		setSourceUrl(url);
	}
	async function begin(url, file, name, owned) {
		abortRef.current?.abort();
		const controller = new AbortController();
		abortRef.current = controller;
		const job = ++jobRef.current;
		adoptUrl(url, owned);
		setSourceName(name);
		setError(null);
		setPhase("analyzing");
		setProgress(0);
		setSamples([]);
		setClips([]);
		setThumbs({});
		setDuration(0);
		setTime(0);
		setPlaying(false);
		try {
			const result = await analyzeSource({
				url,
				file,
				signal: controller.signal,
				onProgress: (value) => {
					if (jobRef.current === job) setProgress(value);
				}
			});
			if (jobRef.current !== job) return;
			setSamples(result.samples);
			setDuration(result.duration);
			setMediaSize({
				w: result.width,
				h: result.height
			});
			setAudioMode(result.audio);
			setPhase("ready");
		} catch (caught) {
			if (jobRef.current !== job) return;
			const message = explain(caught);
			if (!message) return;
			setPhase("empty");
			setSourceUrl(null);
			setError(message);
		}
	}
	function takeFile(file) {
		if (file.size < 1e3) {
			setError("Il file è vuoto o troppo piccolo.");
			return;
		}
		if (!(file.type.startsWith("video/") || /\.(mp4|webm|mov|m4v|ogv|mkv)$/i.test(file.name))) {
			setError("Serve un file video: mp4, webm o mov.");
			return;
		}
		begin(URL.createObjectURL(file), file, file.name, true);
	}
	function openLink(event) {
		event.preventDefault();
		const kind = classifyLink(link);
		if (kind === "bad") {
			setError("Incolla un indirizzo che inizia con http o https.");
			return;
		}
		if (kind === "youtube" || kind === "social") {
			setError("YouTube, Instagram, TikTok e Vimeo non lasciano leggere il file dal browser. Scarica il video, se ne hai il diritto, e caricalo qui. Oppure incolla un link diretto a un mp4 o webm.");
			return;
		}
		begin(link.trim(), null, "Video dal link", false);
	}
	function seek(next) {
		const video = stageRef.current;
		const bounded = clamp(next, 0, duration || video?.duration || 0);
		if (video) video.currentTime = bounded;
		setTime(bounded);
	}
	function toggleStage() {
		const video = stageRef.current;
		if (!video) return;
		if (video.paused) video.play();
		else video.pause();
	}
	function shiftClip(id, start) {
		setClips((current) => current.map((clip) => {
			if (clip.id !== id) return clip;
			const span = clip.end - clip.start;
			const next = clamp(start, 0, Math.max(0, duration - span));
			return {
				...clip,
				start: next,
				end: next + span,
				tuned: true
			};
		}));
		setActiveId(id);
	}
	function toggleReel() {
		const video = phoneRef.current;
		if (!video || !active) return;
		if (!video.paused) {
			video.pause();
			setReelPlaying(false);
			return;
		}
		video.currentTime = active.start;
		video.play();
		setReelPlaying(true);
	}
	async function download(clip, index) {
		if (!sourceUrl || exportLock.current) return false;
		exportLock.current = true;
		const controller = new AbortController();
		exportAbort.current = controller;
		setExporting({
			id: clip.id,
			progress: 0
		});
		setError(null);
		const { width, height } = outputSize(settings.aspect, settings.quality);
		try {
			const result = await exportShort({
				url: sourceUrl,
				start: clip.start,
				end: clip.end,
				width,
				height,
				focusX: settings.focusX,
				focusY: settings.focusY,
				title: settings.title,
				fade: settings.fade,
				signal: controller.signal,
				onProgress: (value) => setExporting({
					id: clip.id,
					progress: value
				})
			});
			const ext = extensionForMime(result.mime);
			const seconds = Math.max(1, Math.round(clip.end - clip.start));
			saveFile(result.blob, `corto-${String(index + 1).padStart(2, "0")}-${seconds}s.${ext}`);
			return true;
		} catch (caught) {
			const message = explain(caught);
			if (message) setError(message);
			return false;
		} finally {
			exportLock.current = false;
			setExporting(null);
		}
	}
	async function downloadAll() {
		for (let index = 0; index < clips.length; index++) {
			const clip = clips[index];
			if (!clip) return;
			if (!await download(clip, index)) return;
		}
	}
	const counts = [
		"auto",
		1,
		2,
		3,
		4
	];
	const aspects = [
		"9:16",
		"4:5",
		"1:1"
	];
	const qualities = ["720", "1080"];
	const phoneAspect = settings.aspect === "1:1" ? "aspect-square" : settings.aspect === "4:5" ? "aspect-portrait" : "aspect-reel";
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "min-h-dvh bg-paper text-ink",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("header", {
			className: "border-b border-ink/10",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "mx-auto flex max-w-6xl items-end justify-between gap-4 px-4 py-4 sm:px-6",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "font-display text-3xl leading-none tracking-tight",
					children: "Corto"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-1 text-sm text-ink/60",
					children: "Studio per shorts"
				})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
					className: "text-right text-sm text-ink/70",
					children: [
						settings.durationSec,
						"s · pulito · ",
						aspectLabel(settings.aspect)
					]
				})]
			})
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
			className: "mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10",
			children: [
				error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					role: "alert",
					className: "mb-6 rounded-2xl bg-sheet px-4 py-3 text-sm leading-relaxed ring-1 ring-ink/10",
					children: error
				}) : null,
				!sourceUrl ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Intake, {
					link,
					over,
					onLink: setLink,
					onSubmit: openLink,
					onFile: takeFile,
					onDemo: () => void begin("/demo.mp4", null, "Video dimostrativo", false),
					onBrowse: () => fileRef.current?.click(),
					onOver: setOver,
					fileRef
				}) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "grid items-start gap-8 lg:grid-cols-5",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
						className: "min-w-0 lg:col-span-3",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "mb-3 flex items-baseline justify-between gap-3",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
									className: "truncate text-sm font-medium",
									children: sourceName
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
									type: "button",
									className: "shrink-0 text-sm text-ink/60 underline-offset-4 hover:underline",
									onClick: () => {
										abortRef.current?.abort();
										setPhase("empty");
										setSourceUrl(null);
										setSamples([]);
										setClips([]);
									},
									children: "Cambia video"
								})]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "relative overflow-hidden rounded-2xl bg-stage shadow-xl",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("video", {
										ref: stageRef,
										src: sourceUrl,
										playsInline: true,
										preload: "metadata",
										className: "max-h-96 w-full bg-stage object-contain",
										onTimeUpdate: (event) => setTime(event.currentTarget.currentTime),
										onPlay: () => setPlaying(true),
										onPause: () => setPlaying(false),
										onEnded: () => setPlaying(false)
									}),
									phase !== "analyzing" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
										type: "button",
										onClick: toggleStage,
										"aria-label": playing ? "Pausa" : "Riproduci",
										className: "absolute bottom-3 left-3 flex size-11 items-center justify-center rounded-full bg-ivory text-ink",
										children: playing ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Pause, { className: "size-5" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Play, { className: "size-5 translate-x-px" })
									}) : null,
									phase === "analyzing" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
										className: "absolute inset-0 flex flex-col justify-end bg-stage/55 p-4 text-ivory",
										children: [
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
												className: "text-sm",
												children: "Lettura di audio e movimento"
											}),
											/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
												className: "mt-1 font-display text-3xl leading-none",
												children: [Math.round(progress * 100), "%"]
											}),
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
												className: "mt-3 h-1 overflow-hidden rounded-full bg-ivory/20",
												children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
													className: "h-full bg-brass",
													style: { width: `${Math.round(progress * 100)}%` }
												})
											})
										]
									}) : null
								]
							}),
							phase === "ready" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "mt-3 flex items-center justify-between text-sm text-ink/60",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: formatClock(time) }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: formatClock(duration) })]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
									className: "mt-2",
									children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Timeline, {
										duration,
										samples,
										clips,
										activeId: active?.id ?? null,
										currentTime: time,
										onSeek: seek,
										onShift: shiftClip
									})
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
									className: "mt-3 text-sm leading-relaxed text-ink/60",
									children: "Le barre alte sono i passaggi più pieni. Il riquadro è lo short: trascinalo per spostarlo, la durata non cambia."
								}),
								audioMode === "missing" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
									className: "mt-2 text-sm text-ink/60",
									children: "L'audio non era leggibile: i tagli seguono solo il movimento."
								}) : null,
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "mt-6 flex items-baseline justify-between gap-3",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
										className: "font-display text-2xl tracking-tight",
										children: clips.length === 1 ? "Un taglio" : `${clips.length} tagli`
									}), tuned ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
										type: "button",
										className: "text-sm text-brass",
										onClick: () => setClips(suggested),
										children: "Ripristina"
									}) : null]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
									className: "mt-4 flex flex-col gap-3",
									children: clips.map((clip, index) => {
										const on = clip.id === active?.id;
										const rank = [...clips].sort((a, b) => b.score - a.score).findIndex((item) => item.id === clip.id);
										return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
											className: `flex gap-3 rounded-2xl bg-sheet p-3 ring-1 ${on ? "ring-ink" : "ring-ink/10"}`,
											children: [
												/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
													type: "button",
													onClick: () => {
														setActiveId(clip.id);
														seek(clip.start);
													},
													className: "relative w-14 shrink-0 overflow-hidden rounded-xl bg-stage",
													children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
														className: phoneAspect + " block w-full",
														children: thumbs[clip.id] ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", {
															src: thumbs[clip.id],
															alt: "",
															className: "h-full w-full object-cover"
														}) : null
													})
												}),
												/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
													className: "min-w-0 flex-1",
													children: [
														/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
															className: "flex items-baseline justify-between gap-2",
															children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
																className: "text-sm font-medium",
																children: rank === 0 ? "Il più pieno" : `Alternativa ${rank + 1}`
															}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
																className: "text-sm text-ink/55",
																children: formatSpan(clip.start, clip.end)
															})]
														}),
														/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
															className: "mt-1 text-sm text-ink/65",
															children: [clip.reasons.join(" · "), clip.tuned ? " · posizione ritoccata" : ""]
														}),
														/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
															className: "mt-3 flex flex-wrap gap-2",
															children: [
																-5,
																-1,
																1,
																5
															].map((delta) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
																type: "button",
																className: "seg bg-paper ring-1 ring-ink/10",
																onClick: () => shiftClip(clip.id, clip.start + delta),
																children: delta > 0 ? `+${delta}s` : `${delta}s`
															}, delta))
														})
													]
												}),
												/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
													className: "hidden pt-1 text-sm text-ink/40 sm:inline",
													children: String(index + 1).padStart(2, "0")
												})
											]
										}) }, clip.id);
									})
								})
							] }) : null
						]
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("aside", {
						className: "min-w-0 lg:col-span-2 lg:sticky lg:top-4",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: `relative mx-auto w-full max-w-60 overflow-hidden rounded-2xl bg-stage ring-1 ring-ink/10 ${phoneAspect}`,
								children: [
									phase === "ready" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("video", {
										ref: phoneRef,
										src: sourceUrl,
										playsInline: true,
										preload: "metadata",
										className: "h-full w-full object-cover",
										style: { objectPosition: `${settings.focusX * 100}% ${settings.focusY * 100}%` },
										onTimeUpdate: (event) => {
											if (!active) return;
											if (event.currentTarget.currentTime >= active.end - .08) event.currentTarget.currentTime = active.start;
										},
										onPause: () => setReelPlaying(false),
										onPlay: () => setReelPlaying(true)
									}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
										className: "flex h-full items-end p-4 text-sm text-ivory/80",
										children: "In attesa del taglio"
									}),
									settings.guides && phase === "ready" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "pointer-events-none absolute inset-x-0 top-0 h-guide-top bg-stage/35" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "pointer-events-none absolute inset-x-0 bottom-0 h-guide-bottom bg-stage/35" })] }) : null,
									settings.title.trim() && phase === "ready" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
										className: "pointer-events-none absolute inset-x-title-x top-title-y text-ivory",
										children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "mb-2 h-0.5 w-8 bg-brass" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
											className: "text-sm font-medium leading-snug",
											children: settings.title.trim()
										})]
									}) : null,
									phase === "ready" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
										type: "button",
										onClick: toggleReel,
										"aria-label": reelPlaying ? "Pausa anteprima" : "Anteprima dello short",
										className: "absolute bottom-3 left-3 flex size-11 items-center justify-center rounded-full bg-ivory text-ink",
										children: reelPlaying ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Pause, { className: "size-5" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Play, { className: "size-5 translate-x-px" })
									}) : null
								]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								type: "button",
								className: "btn btn-ink mt-4 w-full",
								disabled: !active || !!exporting || phase !== "ready",
								onClick: () => {
									if (!active) return;
									const index = Math.max(0, clips.findIndex((clip) => clip.id === active.id));
									download(active, index);
								},
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Download, { className: "size-4" }), exporting ? `Esportazione ${Math.round(exporting.progress * 100)}%` : active ? `Scarica · ${formatClock(active.end - active.start)}` : "Scarica lo short"]
							}),
							exporting ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								className: "btn btn-line mt-2 w-full",
								onClick: () => exportAbort.current?.abort(),
								children: "Annulla esportazione"
							}) : null,
							clips.length > 1 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								className: "btn btn-line mt-2 w-full",
								disabled: !!exporting || phase !== "ready",
								onClick: () => void downloadAll(),
								children: "Scarica tutti"
							}) : null,
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
								className: "mt-3 text-sm leading-relaxed text-ink/60",
								children: [
									"L'esportazione avviene in tempo reale: uno short da ",
									settings.durationSec,
									"s chiede circa",
									" ",
									settings.durationSec,
									" secondi. Il file resta sul dispositivo, pronto per Shorts, Reel o TikTok."
								]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "mt-6 rounded-2xl bg-sheet p-4 ring-1 ring-ink/10",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
										className: "text-sm font-medium",
										children: "Impostazione predefinita"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
										className: "mt-1 text-sm leading-relaxed text-ink/65",
										children: "60 secondi, verticale 9:16, senza titolo e senza effetti. Solo un taglio pulito, con una breve dissolvenza."
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Field, {
										label: "Durata",
										hint: `${settings.durationSec}s`,
										children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
											className: "flex flex-wrap gap-2",
											children: [
												15,
												30,
												60,
												90
											].map((value) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
												type: "button",
												className: "seg",
												"data-on": settings.durationSec === value,
												onClick: () => update({ durationSec: value }),
												children: [value, "s"]
											}, value))
										}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Slider, {
											min: 10,
											max: 90,
											step: 1,
											value: [settings.durationSec],
											onValueChange: ([value]) => update({ durationSec: value ?? 60 }),
											"aria-label": "Durata dello short in secondi",
											className: "relative mt-3 flex h-11 w-full touch-none items-center",
											children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SliderTrack, {
												className: "relative h-1 grow rounded-full bg-ink/15",
												children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SliderRange, { className: "absolute h-full rounded-full bg-brass" })
											}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SliderThumb, { className: "block size-5 rounded-full bg-ink" })]
										})]
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
										label: "Quanti tagli",
										hint: settings.countMode === "auto" ? "Solo i più forti" : "Fissi",
										children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
											className: "flex flex-wrap gap-2",
											children: counts.map((value) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
												type: "button",
												className: "seg",
												"data-on": settings.countMode === value,
												onClick: () => update({ countMode: value }),
												children: value === "auto" ? "Auto" : value
											}, String(value)))
										})
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
										label: "Formato",
										children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
											className: "flex flex-wrap gap-2",
											children: aspects.map((value) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
												type: "button",
												className: "seg",
												"data-on": settings.aspect === value,
												onClick: () => update({ aspect: value }),
												children: aspectLabel(value)
											}, value))
										})
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Field, {
										label: "Fuoco dell'inquadratura",
										hint: wide ? "Video orizzontale" : "Centro",
										children: [
											/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
												className: "mb-2 text-sm text-ink/55",
												children: [
													"Orizzontale · ",
													Math.round(settings.focusX * 100),
													"%"
												]
											}),
											/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Slider, {
												min: 0,
												max: 1,
												step: .01,
												value: [settings.focusX],
												onValueChange: ([value]) => update({ focusX: value ?? .5 }),
												"aria-label": "Fuoco orizzontale",
												className: "relative flex h-11 w-full touch-none items-center",
												children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SliderTrack, {
													className: "relative h-1 grow rounded-full bg-ink/15",
													children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SliderRange, { className: "absolute h-full rounded-full bg-brass" })
												}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SliderThumb, { className: "block size-5 rounded-full bg-ink" })]
											}),
											/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
												className: "mb-2 mt-2 text-sm text-ink/55",
												children: [
													"Verticale · ",
													Math.round(settings.focusY * 100),
													"%"
												]
											}),
											/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Slider, {
												min: 0,
												max: 1,
												step: .01,
												value: [settings.focusY],
												onValueChange: ([value]) => update({ focusY: value ?? .42 }),
												"aria-label": "Fuoco verticale",
												className: "relative flex h-11 w-full touch-none items-center",
												children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SliderTrack, {
													className: "relative h-1 grow rounded-full bg-ink/15",
													children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SliderRange, { className: "absolute h-full rounded-full bg-brass" })
												}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SliderThumb, { className: "block size-5 rounded-full bg-ink" })]
											}),
											wide ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
												className: "mt-2 text-sm leading-relaxed text-ink/60",
												children: "Lo short ritaglia il fotogramma. Sposta il fuoco se il soggetto non è al centro."
											}) : null
										]
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
										label: "Titolo in quadro",
										hint: "Opzionale",
										children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
											value: settings.title,
											maxLength: 80,
											placeholder: "Vuoto: nessuno testo",
											onChange: (event) => update({ title: event.target.value }),
											className: "h-11 w-full rounded-full bg-paper px-4 text-sm ring-1 ring-ink/15"
										})
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
										label: "Finitura",
										children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
											className: "flex flex-wrap gap-2",
											children: [
												/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
													type: "button",
													className: "seg",
													"data-on": settings.fade,
													onClick: () => update({ fade: !settings.fade }),
													children: "Dissolvenza"
												}),
												/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
													type: "button",
													className: "seg",
													"data-on": settings.guides,
													onClick: () => update({ guides: !settings.guides }),
													children: "Zone sicure"
												}),
												qualities.map((value) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
													type: "button",
													className: "seg",
													"data-on": settings.quality === value,
													onClick: () => update({ quality: value }),
													children: [value, "p"]
												}, value))
											]
										})
									})
								]
							})
						]
					})]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("footer", {
					className: "mt-12 border-t border-ink/10 pt-6 text-sm leading-relaxed text-ink/55",
					children: "Tutto resta nel browser: il video non viene inviato a un server. Per questo Corto si apre come un sito statico. I link delle piattaforme social non sono leggibili; un file o un URL diretto sì."
				})
			]
		})]
	});
}
function Field({ label, hint, children }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "mt-5",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "mb-2 flex items-baseline justify-between gap-3",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-sm font-medium",
				children: label
			}), hint ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-sm text-ink/50",
				children: hint
			}) : null]
		}), children]
	});
}
function Intake({ link, over, onLink, onSubmit, onFile, onDemo, onBrowse, onOver, fileRef }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
			className: "max-w-xl font-display text-4xl leading-tight tracking-tight sm:text-5xl",
			children: "I momenti che contano, in un minuto."
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "mt-4 max-w-xl text-base leading-relaxed text-ink/70",
			children: "Carica un video o incolla un link diretto. Corto individua i passaggi più pieni e li consegna in shorts da 60 secondi, verticali e senza effetti."
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: `mt-8 rounded-3xl bg-sheet px-5 py-8 ring-1 sm:px-8 ${over ? "ring-brass" : "ring-ink/10"}`,
			onDragOver: (event) => {
				event.preventDefault();
				onOver(true);
			},
			onDragLeave: () => onOver(false),
			onDrop: (event) => {
				event.preventDefault();
				onOver(false);
				const file = event.dataTransfer.files[0];
				if (file) onFile(file);
			},
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "font-display text-3xl tracking-tight",
					children: "Porta un video"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-2 max-w-md text-sm leading-relaxed text-ink/65",
					children: "Trascinalo qui, oppure scegli un file mp4, webm o mov. Non lascia questo dispositivo."
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "mt-6 flex flex-wrap gap-3",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						className: "btn btn-ink",
						onClick: onBrowse,
						children: "Scegli un file"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						className: "btn btn-line",
						onClick: onDemo,
						children: "Video dimostrativo"
					})]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
					ref: fileRef,
					type: "file",
					accept: "video/mp4,video/webm,video/quicktime,video/*",
					className: "sr-only",
					onChange: (event) => {
						const file = event.target.files?.[0];
						event.target.value = "";
						if (file) onFile(file);
					}
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
					onSubmit,
					className: "mt-8",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", {
						htmlFor: "video-link",
						className: "text-sm font-medium",
						children: "Link diretto al file"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "mt-2 flex flex-col gap-2 sm:flex-row",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							id: "video-link",
							value: link,
							inputMode: "url",
							placeholder: "https://…/filmato.mp4",
							onChange: (event) => onLink(event.target.value),
							className: "h-11 min-w-0 flex-1 rounded-full bg-paper px-4 text-sm ring-1 ring-ink/15"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "submit",
							className: "btn btn-line",
							children: "Apri"
						})]
					})]
				})
			]
		})
	] });
}
var SplitComponent = Studio;
//#endregion
export { SplitComponent as component };
