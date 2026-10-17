package lab.mindustry;

import arc.Events;
import arc.util.CommandHandler;
import arc.util.Log;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import mindustry.Vars;
import mindustry.content.Items;
import mindustry.game.EventType.Trigger;
import mindustry.mod.Plugin;
import mindustry.world.blocks.storage.CoreBlock.CoreBuild;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

public final class AgentLabPlugin extends Plugin {
    // Only game-thread code reads Vars. HTTP threads read this immutable cache.
    private volatile String stateJson = "{\"schemaVersion\":1,\"ready\":false}";
    private int frame;
    private HttpServer server;

    @Override
    public void init() {
        Events.run(Trigger.update, () -> {
            if (++frame % 30 == 0) stateJson = captureState();
        });

        int port = Integer.getInteger("mindustry.agentlab.port", 8766);
        if (port < 1 || port > 65535) {
            Log.err("[AgentLab] Invalid port: @", port);
            return;
        }
        try {
            // Loopback by default; never expose the read-only endpoint to the LAN.
            server = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 8);
            server.createContext("/v1/health", exchange -> reply(exchange, 200,
                    "{\"service\":\"mindustry-agent-lab\",\"schemaVersion\":1,\"readOnly\":true}"));
            server.createContext("/v1/state", exchange -> reply(exchange, 200, stateJson));
            server.start();
            Log.info("[AgentLab] read-only API at http://127.0.0.1:@/v1/state", port);
            Runtime.getRuntime().addShutdownHook(new Thread(() -> {
                if (server != null) server.stop(0);
            }, "agentlab-shutdown"));
        } catch (IOException error) {
            Log.err("[AgentLab] Could not bind local HTTP endpoint: @", error.getMessage());
        }
    }

    @Override
    public void registerServerCommands(CommandHandler handler) {
        handler.register("agentlab", "Print the latest cached read-only AgentLab state.", args ->
                Log.info("[AgentLab] @", stateJson));
    }

    private String captureState() {
        if (Vars.state == null || !Vars.state.isGame() || Vars.world == null || Vars.world.width() == 0) {
            return "{\"schemaVersion\":1,\"ready\":false}";
        }
        CoreBuild core = Vars.state.teams.playerCores().firstOpt();
        String coreJson = core == null ? "null" : String.format(Locale.ROOT,
                "{\"x\":%d,\"y\":%d,\"health\":%d,\"copper\":%d,\"lead\":%d}",
                core.tile.x, core.tile.y, Math.round(core.health),
                core.items.get(Items.copper), core.items.get(Items.lead));
        return String.format(Locale.ROOT,
                "{\"schemaVersion\":1,\"ready\":true,\"wave\":%d,\"tick\":%d,"
                + "\"width\":%d,\"height\":%d,\"playing\":%s,\"gameOver\":%s,"
                + "\"won\":%s,\"core\":%s}",
                Vars.state.wave, Math.round(Vars.state.tick), Vars.world.width(),
                Vars.world.height(), Vars.state.isPlaying(), Vars.state.gameOver,
                Vars.state.won, coreJson);
    }

    private static void reply(HttpExchange exchange, int code, String body) throws IOException {
        try {
            if (!"GET".equals(exchange.getRequestMethod())) {
                exchange.getResponseHeaders().set("Allow", "GET");
                code = 405;
                body = "{\"error\":\"method_not_allowed\"}";
            }
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
            exchange.getResponseHeaders().set("Cache-Control", "no-store");
            exchange.sendResponseHeaders(code, bytes.length);
            exchange.getResponseBody().write(bytes);
        } finally {
            exchange.close();
        }
    }
}
