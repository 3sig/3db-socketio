import { io } from "socket.io-client";

export {
  onInitialize,
  emitUpdate as onUpdate,
  emitUpdate as onGet
}

let socket;


async function onInitialize(config, runApi) {
  console.log('[socketio] onInitialize');

  socket = io("ws://" + config.serverUrl);

  socket.on("connect", () => {
    console.log("[socketio] Connected to server at " + config.serverUrl);
  });

  socket.on("disconnect", (reason) => {
    console.log("[socketio] Disconnected from server:", reason);
  });

  socket.on("connect_error", (error) => {
    console.error("[socketio] Connection error:", error);
  });

  socket.on("reconnect", (attemptNumber) => {
    console.log("[socketio] Reconnected after", attemptNumber, "attempts");
  });

  socket.on("reconnect_error", (error) => {
    console.error("[socketio] Reconnection error:", error);
  });

  // Handle incoming messages and relay them to the database
  socket.onAny(async (eventName, data) => {
    console.log("received", eventName, data)
    try {
      if (!eventName.startsWith(config.socketioPrefix || '')) {
        return;
      }

      eventName = eventName.slice(config.socketioPrefix?.length || 0);

      let [plugin,api,...target] = eventName.split("/");
      eventName = plugin + "/" + api;
      target = target.join("/");

      console.log("running api with", eventName, target, data)
      await runApi(eventName, target, data)
    } catch (error) {
      console.error("[socketio] Error handling incoming message:", error);
    }
  });
}

async function emitUpdate(config, runApi, id, data) {
  console.log("emitUpdate", id, data)
  if (socket && socket.connected) {
    try {
      const eventName = (config.socketioPrefix || '') + id;
      socket.emit(eventName, data);
      console.log("[socketio] Emitted update for", eventName, "with data:", data);
    } catch (error) {
      console.error("[socketio] Error emitting update:", error);
    }
  }
}
