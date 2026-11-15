import React, { useState, useEffect, useRef } from "react";
import { View, Text, TextInput, Pressable, AppState } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Crypto from "expo-crypto";
import { fieldStore } from "./storage/field-store.js";
import { createApiClient } from "../../packages/api-client/index.js";
import { createSyncCoordinator } from "../../packages/api-client/sync.js";
import { subscribeScanner } from "./scanner.js";
function FieldDriverPanel() {
  const [actor, setActor] = useState("local-demo-driver"), [tenant, setTenant] = useState("c2"), [token, setToken] = useState(""), [connected, setConnected] = useState(false), [state, setState] = useState(null), [queue, setQueue] = useState([]), [selected, setSelected] = useState(""), [barcode, setBarcode] = useState("DEMO-BIN-0001"), [production, setProduction] = useState("2"), [ack, setAck] = useState("demo-customer"), [reason, setReason] = useState("demo-review"), [notice, setNotice] = useState("On-device synthetic driver demonstration."), [replacement, setReplacement] = useState(null), [busy, setBusy] = useState(false), [intent, setIntent] = useState(false), [camera, setCamera] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const lock = useRef(false), generation = useRef(0), scanRef = useRef(null), coordinator = useRef(null);
  const api = () => createApiClient({ baseUrl: "http://127.0.0.1:8787", getAccessToken: () => token, readOnly: false });
  async function reload() {
    setState(await fieldStore.loadWorkspace(actor, tenant));
    setQueue(await fieldStore.workflowRepository(actor, tenant).read());
  }
  useEffect(() => {
    let live = true;
    setState(null);
    setQueue([]);
    setCamera(false);
    setReplacement(null);
    setIntent(false);
    generation.current++;
    Promise.all([fieldStore.loadWorkspace(actor, tenant), fieldStore.workflowRepository(actor, tenant).read()]).then(([s, q]) => {
      if (live) {
        setState(s);
        setQueue(q);
        setSelected(s.jobs[0]?.id || "");
      }
    }).catch((e) => setNotice(e.message));
    return () => {
      live = false;
      generation.current++;
    };
  }, [actor, tenant]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s !== "active") setCamera(false);
    });
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (!intent) return;
    const sub = subscribeScanner((value) => scanRef.current?.(value));
    if (!sub.available) setNotice("Intent scanning needs a native Zebra build. Keyboard and camera remain available.");
    return () => sub.remove();
  }, [intent]);
  async function run(work) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await work();
    } catch (e) {
      setNotice(e.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function stage(type, input = {}) {
    await run(async () => {
      const j = state.jobs.find((j2) => j2.id === selected);
      if (!j) throw Error("Select an assignment");
      await fieldStore.stageCommand(actor, tenant, { clientEventId: "demo-" + Crypto.randomUUID(), type, input: { ...input, jobId: j.id, ...replacement ? { reviewNote: reason } : {} }, expectedJobVersion: j.version }, replacement);
      setReplacement(null);
      await reload();
      setNotice("Saved atomically in the driver queue. Not yet acknowledged by the selected receiver.");
    });
  }
  scanRef.current = (value) => {
    setCamera(false);
    setBarcode(value.trim().toUpperCase());
    stage("scan_bin", { barcode: value.trim().toUpperCase() });
  };
  async function connect() {
    await run(async () => {
      const current = await api().getSession();
      if (current.user.role !== "warehouse" || !current.customerIds.includes(tenant)) throw Error("An active scoped warehouse driver session is required");
      const s = await api().getFieldWorkspace(tenant);
      const existing = await fieldStore.workflowRepository(current.user.id, tenant).read();
      if (!existing.some((e) => ["pending", "sending"].includes(e.status))) await fieldStore.cacheWorkspace(current.user.id, tenant, s);
      setActor(current.user.id);
      setConnected(true);
      setNotice("Verified loopback driver session connected. No public field API is enabled.");
    });
  }
  async function sync() {
    await run(async () => {
      const repository = fieldStore.workflowRepository(actor, tenant);
      const receiver = connected ? { submitScan: async (event) => {
        if (event.actorId !== actor) throw Error("Queue owner changed");
        return api().fieldCommand({ customerId: tenant, command: event.command });
      } } : fieldStore.syntheticWorkflowReceiver();
      coordinator.current = createSyncCoordinator({ repository, api: receiver });
      const result = await coordinator.current.synchronize();
      if (result.status === "auth-required") {
        setConnected(false);
        setToken("");
        setActor("local-demo-driver");
        setState(null);
        setQueue([]);
        setNotice("Authorization required. Previous driver queue is preserved; sign in again to resume.");
        return;
      }
      await reload();
      setNotice(result.processed + " queued events processed. Review conflicts before refreshing assignments.");
    });
  }
  async function refresh() {
    await run(async () => {
      if (!connected) throw Error("On-device assignments are already stored locally");
      const s = await api().getFieldWorkspace(tenant);
      await fieldStore.cacheWorkspace(actor, tenant, s);
      await reload();
      setNotice("Assignments refreshed. Queued/conflicted evidence remains in SQLite.");
    });
  }
  async function disconnect() {
    await run(async () => {
      const previous = connected;
      setConnected(false);
      setActor("local-demo-driver");
      setState(null);
      setQueue([]);
      if (previous) try {
        await api().endSession();
      } catch {
        setNotice("Session revocation could not be confirmed; it remains subject to expiry.");
      }
      setToken("");
      setNotice("Disconnected. Prior driver queues remain isolated in SQLite.");
    });
  }
  const btn = (label, fn) => <Pressable accessibilityRole="button" disabled={busy} onPress={fn} style={{ padding: 12, backgroundColor: "#146d9c", borderRadius: 8 }}><Text style={{ color: "white", fontWeight: "700" }}>{label}</Text></Pressable>;
  return <View style={{ padding: 16, backgroundColor: "white", borderRadius: 16, gap: 10 }}><Text style={{ fontSize: 20, fontWeight: "800" }}>Driver assignments · SYNTHETIC</Text><Text>iPhone camera, Zebra intent or keyboard input. No real destruction or road-safe navigation. On-device acknowledgments are simulator acknowledgments.</Text><TextInput accessibilityLabel="Driver customer scope" editable={!busy && !connected} value={tenant} onChangeText={setTenant} />{!connected ? <><TextInput accessibilityLabel="Temporary local driver session" editable={!busy} secureTextEntry value={token} onChangeText={setToken} placeholder="Verified local driver session" />{btn("Connect verified loopback session", connect)}</> : btn("Disconnect and revoke session", disconnect)}{btn("Refresh assignments", refresh)}{state?.jobs.map((j) => <Pressable accessibilityRole="button" key={j.id} disabled={busy} onPress={() => setSelected(j.id)}><Text style={{ fontWeight: selected === j.id ? "800" : "400" }}>{j.reviewRequired ? "SUPERVISOR REVIEW REQUIRED \xB7 " : ""}{j.name} · {j.address} · {j.timezone} · {j.date} · {j.status} · Bins {j.bins.length}/{j.containers}</Text></Pressable>)}{btn("Start selected job", () => stage("start_job"))}{btn("Record arrival", () => stage("arrive_job"))}<TextInput accessibilityLabel="Driver bin barcode" editable={!busy} value={barcode} onChangeText={setBarcode} onSubmitEditing={() => scanRef.current?.(barcode)} />{btn("Record bin scan", () => scanRef.current?.(barcode))}{btn(intent ? "Use keyboard instead" : "Use Zebra intent input", () => setIntent(!intent))}{btn(camera ? "Close camera" : "Scan using camera", async () => {
    if (camera) {
      setCamera(false);
      return;
    }
    const p = permission?.granted ? permission : await requestPermission();
    if (p.granted) setCamera(true);
    else setNotice("Camera access denied. Keyboard scanning remains available.");
  })}{camera && <CameraView style={{ height: 240 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ["code128", "code39", "qr"] }} onBarcodeScanned={(result) => scanRef.current?.(result.data)} />}<TextInput accessibilityLabel="Driver production quantity" editable={!busy} value={production} onChangeText={setProduction} keyboardType="number-pad" /><TextInput accessibilityLabel="Fictional customer acknowledgment" editable={!busy} value={ack} onChangeText={setAck} />{btn("Complete synthetic service", () => stage("complete_job", { production: Number(production), acknowledgment: ack }))}<TextInput accessibilityLabel="Driver exception or review note" editable={!busy} value={reason} onChangeText={setReason} />{btn("Report exception", () => stage("job_exception", { reason }))}{btn("Record SAMPLE performed evidence after authorization", () => stage("perform_demo_destruction"))}{btn("Synchronize durable queue", sync)}<Text>Navigation provider unavailable. Use only approved commercial navigation outside this synthetic demonstration.</Text><Text accessibilityRole="alert">{notice}</Text>{queue.map((e) => <View key={e.clientEventId}><Text>{e.command.type} · {e.status}{e.lastError ? " \xB7 " + e.lastError : ""}{e.supersededBy ? " \xB7 reviewed" : ""}</Text>{e.status === "conflict" && !e.supersededBy && btn("Prepare reviewed replacement", () => {
    setSelected(e.command.input.jobId);
    setReplacement(e.clientEventId);
    setNotice("Refresh assignments, review current job and enter a corrected action. Original conflict will be preserved.");
  })}{e.status === "conflict" && !e.supersededBy && btn("Retain conflict without retry", () => run(async () => {
    await fieldStore.dismissConflict(actor, tenant, e.clientEventId, reason);
    await reload();
  }))}</View>)}</View>;
}
export {
  FieldDriverPanel as default
};
