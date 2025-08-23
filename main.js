import { io } from "socket.io-client";

export {
  onInitialize,
  emitUpdate as onUpdate,
  emitUpdate as onGet
}

let socket;

async function onInitialize(config, runApi) {
  console.log('[socketio] Initializing Socket.IO client');
  if (config.verbose) {
    console.log('[socketio] Config:', { serverUrl: config.serverUrl, socketioPrefix: config.socketioPrefix });
  }

  const serverUrl = "ws://" + config.serverUrl;
  console.log('[socketio] Connecting to server:', serverUrl);
  socket = io(serverUrl);

  socket.on("connect", () => {
    console.log("[socketio] Connected to server:", config.serverUrl);
    if (config.verbose) {
      console.log("[socketio] Socket ID:", socket.id);
    }
  });

  socket.on("disconnect", (reason) => {
    console.log("[socketio] Disconnected from server:", reason);
    if (config.verbose) {
      console.log("[socketio] Disconnect details - socket connected:", socket.connected);
    }
  });

  socket.on("connect_error", (error) => {
    console.error("[socketio] Connection error:", error.message || error);
    if (config.verbose) {
      console.error("[socketio] Full connection error:", error);
    }
  });

  socket.on("reconnect", (attemptNumber) => {
    console.log("[socketio] Reconnected after", attemptNumber, "attempts");
    if (config.verbose) {
      console.log("[socketio] Reconnection successful - socket ID:", socket.id);
    }
  });

  socket.on("reconnect_error", (error) => {
    console.error("[socketio] Reconnection error:", error.message || error);
    if (config.verbose) {
      console.error("[socketio] Full reconnection error:", error);
    }
  });

  socket.onAny(async (eventName, data) => {
    console.log("[socketio] Received event:", eventName);
    if (config.verbose) {
      console.log("[socketio] Event data:", data);
      console.log("[socketio] Checking prefix filter:", config.socketioPrefix);
    }

    try {
      if (!eventName.startsWith(config.socketioPrefix || '')) {
        if (config.verbose) {
          console.log("[socketio] Event ignored - prefix mismatch");
        }
        return;
      }

      const originalEventName = eventName;
      eventName = eventName.slice(config.socketioPrefix?.length || 0);

      let [plugin, api, ...target] = eventName.split("/");
      eventName = plugin + "/" + api;
      target = target.join("/");

      console.log("[socketio] Processing API call:", eventName, "target:", target);
      if (config.verbose) {
        console.log("[socketio] API call details - original event:", originalEventName, "parsed plugin:", plugin, "parsed api:", api, "parsed target:", target, "data:", data);
        console.log("[socketio] Calling runApi...");
      }

      await runApi(eventName, target, data);

      if (config.verbose) {
        console.log("[socketio] API call completed successfully");
      }
    } catch (error) {
      console.error("[socketio] Error handling incoming message:", error.message || error);
      if (config.verbose) {
        console.error("[socketio] Full error details:", error);
        console.error("[socketio] Error stack:", error.stack);
      }
    }
  });
}

async function emitUpdate(config, runApi, id, data) {
  console.log("[socketio] Emitting update for ID:", id);
  if (config.verbose) {
    console.log("[socketio] Emit details - socket connected:", socket?.connected, "data:", data);
  }

  if (socket && socket.connected) {
    try {
      const eventName = (config.socketioPrefix || '') + id;
      if (config.verbose) {
        console.log("[socketio] Emitting event:", eventName, "with prefix:", config.socketioPrefix);
      }

      socket.emit(eventName, data);
      console.log("[socketio] Successfully emitted event:", eventName);

      if (config.verbose) {
        console.log("[socketio] Emit completed - event:", eventName, "data:", data);
      }
    } catch (error) {
      console.error("[socketio] Error emitting update:", error.message || error);
      if (config.verbose) {
        console.error("[socketio] Full emit error:", error);
        console.error("[socketio] Error stack:", error.stack);
      }
    }
  } else {
    console.log("[socketio] Cannot emit - socket not connected");
    if (config.verbose) {
      console.log("[socketio] Socket state - exists:", !!socket, "connected:", socket?.connected);
    }
  }
  return data;
}
