package lab.mindustry;

import arc.Events;
import arc.util.CommandHandler;
import arc.util.Log;
import arc.util.serialization.JsonReader;
import arc.util.serialization.JsonValue;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import mindustry.Vars;
import mindustry.content.Blocks;
import mindustry.content.Items;
import mindustry.entities.units.BuildPlan;
import mindustry.ai.types.BuilderAI;
import mindustry.game.EventType.Trigger;
import mindustry.game.EventType.WorldLoadEvent;
import mindustry.gen.Groups;
import mindustry.gen.Unit;
import mindustry.mod.Plugin;
import mindustry.type.ItemStack;
import mindustry.world.Build;
import mindustry.world.Block;
import mindustry.world.Tile;
import mindustry.world.blocks.storage.CoreBlock.CoreBuild;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayDeque;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/**
 * M1: localhost-only bridge, with an opt-in authenticated construction queue.
 * HTTP never reads the game world or modifies entities. All Mindustry API work
 * (including placement checks, builder assignment and confirmation) happens
 * in Trigger.update on the server's game thread.
 */
public final class AgentLabPlugin extends Plugin {
    private static final int MAX_QUEUE = 16;
    private static final int MAX_HISTORY = 128;
    private static final long BUILD_TIMEOUT_TICKS = 60L * 60L;
    private final Object lock = new Object();
    private final ArrayDeque<Command> pending = new ArrayDeque<>();
    private final LinkedHashMap<String, Command> commands = new LinkedHashMap<>();
    private volatile String stateJson = "{\"schemaVersion\":1,\"ready\":false}";
    private volatile long episode = 0;
    private int frame;
    private long updates;
    private HttpServer server;
    private String token;

    private static final class Command {
        final String id, blockName;
        final int x, y, rotation;
        final long episode;
        volatile String status = "queued";
        volatile String reason = "";
        volatile int unitId = -1;
        volatile long assignedAt;
        Command(String id, String blockName, int x, int y, int rotation, long episode) {
            this.id = id; this.blockName = blockName; this.x = x; this.y = y;
            this.rotation = rotation; this.episode = episode;
        }
        boolean same(Command other) {
            return blockName.equals(other.blockName) && x == other.x &&
                y == other.y && rotation == other.rotation && episode == other.episode;
        }
        String json() {
            return String.format(Locale.ROOT,
                "{\"id\":\"%s\",\"block\":\"%s\",\"x\":%d,\"y\":%d,\"rotation\":%d," +
                "\"episode\":%d,\"status\":\"%s\",\"reason\":\"%s\",\"builderId\":%d}",
                id, blockName, x, y, rotation, episode, status, reason, unitId);
        }
        boolean terminal() {
            return status.equals("completed") || status.equals("rejected") ||
                status.equals("failed") || status.equals("canceled");
        }
    }

    @Override
    public void init() {
        token = System.getenv("MINDUSTRY_AGENT_TOKEN");
        if (token != null && !token.matches("[A-Za-z0-9_-]{32,128}")) {
            Log.warn("[AgentLab] Invalid MINDUSTRY_AGENT_TOKEN; write API disabled.");
            token = null;
        }
        Events.on(WorldLoadEvent.class, event -> {
            synchronized (lock) {
                episode++;
                for (Command command : commands.values()) {
                    if (!command.terminal()) {
                        command.status = "canceled";
                        command.reason = "world_changed";
                    }
                }
                pending.clear();
                pruneHistory();
            }
        });
        Events.run(Trigger.update, () -> {
            updates++;
            if (++frame % 30 == 0) stateJson = captureState();
            processQueue();
            confirmPlans();
        });

        int port = Integer.getInteger("mindustry.agentlab.port", 8766);
        if (port < 1 || port > 65535) {
            Log.err("[AgentLab] Invalid port: @", port);
            return;
        }
        try {
            server = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 8);
            server.createContext("/v1/health", exchange -> reply(exchange, "GET", 200,
                "{\"service\":\"mindustry-agent-lab\",\"schemaVersion\":1,\"readOnly\":" +
                (token == null) + ",\"m1\":true}"));
            server.createContext("/v1/state", exchange ->
                reply(exchange, "GET", 200, stateJson));
            server.createContext("/v1/build", this::submitBuild);
            server.createContext("/v1/commands/", this::readCommand);
            server.start();
            Log.info("[AgentLab] loopback bridge at http://127.0.0.1:@; M1 writes @.",
                port, token == null ? "disabled" : "opt-in enabled");
            Runtime.getRuntime().addShutdownHook(new Thread(() -> {
                if (server != null) server.stop(0);
            }, "agentlab-shutdown"));
        } catch (IOException error) {
            Log.err("[AgentLab] Could not bind local HTTP endpoint: @", error.getMessage());
        }
    }

    @Override
    public void registerServerCommands(CommandHandler handler) {
        handler.register("agentlab", "Print cached AgentLab state and M1 write gate.", args ->
            Log.info("[AgentLab] @ | writes @", stateJson, token == null ? "disabled" : "enabled"));
    }

    private boolean authorized(HttpExchange exchange) {
        if (token == null) return false;
        String supplied = exchange.getRequestHeaders().getFirst("Authorization");
        if (supplied == null || !supplied.startsWith("Bearer ")) return false;
        byte[] provided = supplied.substring(7).getBytes(StandardCharsets.UTF_8);
        byte[] expected = token.getBytes(StandardCharsets.UTF_8);
        return MessageDigest.isEqual(provided, expected);
    }

    private void submitBuild(HttpExchange exchange) throws IOException {
        if (!"POST".equals(exchange.getRequestMethod())) {
            reply(exchange, "POST", 405, "{\"error\":\"method_not_allowed\"}");
            return;
        }
        if (token == null) {
            reply(exchange, "POST", 403, "{\"error\":\"write_disabled\"}");
            return;
        }
        if (!authorized(exchange)) {
            reply(exchange, "POST", 401, "{\"error\":\"unauthorized\"}");
            return;
        }
        if (!"application/json".equalsIgnoreCase(exchange.getRequestHeaders()
                .getFirst("Content-Type"))) {
            reply(exchange, "POST", 415, "{\"error\":\"json_required\"}");
            return;
        }
        byte[] body = exchange.getRequestBody().readNBytes(1025);
        if (body.length > 1024) {
            reply(exchange, "POST", 413, "{\"error\":\"body_too_large\"}");
            return;
        }
        final Command proposal;
        try {
            JsonValue input = new JsonReader().parse(new String(body, StandardCharsets.UTF_8));
            if (!input.isObject() || input.get("id") == null ||
                    input.get("block") == null || input.get("x") == null ||
                    input.get("y") == null || input.get("rotation") == null) {
                throw new IllegalArgumentException("missing_fields");
            }
            String id = input.getString("id");
            String name = input.getString("block");
            JsonValue x = input.get("x"), y = input.get("y"), rot = input.get("rotation");
            if (!id.matches("[A-Za-z0-9_-]{1,48}") ||
                    !name.matches("conveyor|router|junction") ||
                    !x.isNumber() || !y.isNumber() || !rot.isNumber() ||
                    !x.asString().matches("[0-9]{1,4}") ||
                    !y.asString().matches("[0-9]{1,4}") ||
                    !rot.asString().matches("[0-3]")) {
                throw new IllegalArgumentException("invalid_command");
            }
            int ix = x.asInt(), iy = y.asInt(), ir = rot.asInt();
            // Coordinates have a static bound; actual world bounds are checked on the game thread.
            if (ix > 999 || iy > 999) throw new IllegalArgumentException("invalid_coordinates");
            proposal = new Command(id, name, ix, iy, ir, episode);
        } catch (RuntimeException error) {
            reply(exchange, "POST", 422, "{\"error\":\"invalid_command\"}");
            return;
        }
        synchronized (lock) {
            Command old = commands.get(proposal.id);
            if (old != null) {
                if (!old.same(proposal)) {
                    reply(exchange, "POST", 409, "{\"error\":\"idempotency_conflict\"}");
                } else {
                    reply(exchange, "POST", 200, old.json());
                }
                return;
            }
            if (pending.size() >= MAX_QUEUE || commands.size() >= MAX_HISTORY) {
                reply(exchange, "POST", 429, "{\"error\":\"queue_or_history_full\"}");
                return;
            }
            commands.put(proposal.id, proposal);
            pending.addLast(proposal);
            reply(exchange, "POST", 202, proposal.json());
        }
    }

    private void readCommand(HttpExchange exchange) throws IOException {
        if (!"GET".equals(exchange.getRequestMethod())) {
            reply(exchange, "GET", 405, "{\"error\":\"method_not_allowed\"}");
            return;
        }
        if (!authorized(exchange)) {
            reply(exchange, "GET", 401, "{\"error\":\"unauthorized\"}");
            return;
        }
        String id = exchange.getRequestURI().getPath().substring("/v1/commands/".length());
        if (!id.matches("[A-Za-z0-9_-]{1,48}")) {
            reply(exchange, "GET", 400, "{\"error\":\"invalid_id\"}");
            return;
        }
        synchronized (lock) {
            Command command = commands.get(id);
            reply(exchange, "GET", command == null ? 404 : 200,
                command == null ? "{\"error\":\"not_found\"}" : command.json());
        }
    }

    private static Block blockFor(String name) {
        return switch (name) {
            case "conveyor" -> Blocks.conveyor;
            case "router" -> Blocks.router;
            case "junction" -> Blocks.junction;
            default -> null;
        };
    }

    private void processQueue() {
        Command command;
        synchronized (lock) {
            command = pending.pollFirst();
        }
        if (command == null) return;
        if (command.episode != episode || Vars.state == null || !Vars.state.isPlaying() ||
                Vars.state.gameOver || Vars.state.won || Vars.world == null) {
            reject(command, "episode_not_playing");
            return;
        }
        CoreBuild core = Vars.state.teams.playerCores().firstOpt();
        if (core == null) { reject(command, "no_core"); return; }
        Block block = blockFor(command.blockName);
        Tile tile = Vars.world.tile(command.x, command.y);
        if (block == null || tile == null || !Build.validPlace(block, core.team,
                command.x, command.y, command.rotation)) {
            reject(command, "invalid_placement");
            return;
        }
        for (ItemStack requirement : block.requirements) {
            if (core.items.get(requirement.item) < requirement.amount) {
                reject(command, "insufficient_resources");
                return;
            }
        }
        final Unit[] builder = new Unit[1];
        Groups.unit.each(unit -> {
            if (builder[0] == null && unit.team() == core.team &&
                    unit.type().buildSpeed > 0f && unit.controller() instanceof BuilderAI &&
                    !unit.isBuilding()) builder[0] = unit;
        });
        if (builder[0] == null) { reject(command, "no_idle_builder_ai"); return; }
        builder[0].addBuild(new BuildPlan(command.x, command.y, command.rotation, block));
        command.unitId = builder[0].id();
        command.assignedAt = updates;
        command.status = "assigned";
    }

    private void confirmPlans() {
        synchronized (lock) {
            for (Command command : commands.values()) {
                if (!"assigned".equals(command.status)) continue;
                if (command.episode != episode || Vars.state == null || !Vars.state.isPlaying()) {
                    command.status = "canceled";
                    command.reason = "world_changed";
                    continue;
                }
                Tile tile = Vars.world.tile(command.x, command.y);
                Block block = blockFor(command.blockName);
                if (tile != null && block != null && tile.block() == block &&
                        tile.team() == Vars.state.rules.defaultTeam) {
                    command.status = "completed";
                } else if (updates - command.assignedAt > BUILD_TIMEOUT_TICKS) {
                    command.status = "failed";
                    command.reason = "build_timeout";
                }
            }
            pruneHistory();
        }
    }

    private void reject(Command command, String reason) {
        command.status = "rejected";
        command.reason = reason;
    }

    private void pruneHistory() {
        // Keep all nonterminal entries and the most recent 128 results, ensuring
        // old IDs cannot be replayed while retained. When full, reject new IDs.
        while (commands.size() > MAX_HISTORY) {
            Map.Entry<String, Command> oldest = commands.entrySet().iterator().next();
            if (!oldest.getValue().terminal()) break;
            commands.remove(oldest.getKey());
        }
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
                "{\"schemaVersion\":1,\"ready\":true,\"wave\":%d,\"tick\":%d," +
                "\"width\":%d,\"height\":%d,\"playing\":%s,\"gameOver\":%s," +
                "\"won\":%s,\"core\":%s}",
                Vars.state.wave, Math.round(Vars.state.tick), Vars.world.width(),
                Vars.world.height(), Vars.state.isPlaying(), Vars.state.gameOver,
                Vars.state.won, coreJson);
    }

    private static void reply(HttpExchange exchange, String method, int code, String body) throws IOException {
        try {
            if (!method.equals(exchange.getRequestMethod())) {
                exchange.getResponseHeaders().set("Allow", method);
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
