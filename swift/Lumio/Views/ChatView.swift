import SwiftUI

/// Discussion de la famille (serveur Lumio) : remarques et propositions de films / séries.
struct ChatView: View {
    @Environment(AppSession.self) private var session
    @Environment(AppState.self) private var state
    @State private var messages: [ChatMessage] = []
    @State private var me: ChatMe?
    @State private var text = ""
    @State private var error: String?
    @State private var sending = false

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 10) {
                        if let error { Text(error).font(.footnote).foregroundStyle(.orange).padding() }
                        ForEach(messages) { m in
                            bubble(m).id(m.id)
                        }
                    }
                    .padding()
                }
                .onChange(of: messages.count) { _, _ in
                    if let last = messages.last { withAnimation { proxy.scrollTo(last.id, anchor: .bottom) } }
                }
            }
            HStack(spacing: 10) {
                TextField("Message", text: $text, axis: .vertical)
                    .lineLimit(1...5)
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .background(Theme.surfaceHigh, in: RoundedRectangle(cornerRadius: 20))
                    .onSubmit(send)
                Button(action: send) {
                    Image(systemName: "arrow.up.circle.fill").font(.system(size: 32))
                }
                .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || sending)
            }
            .padding()
            .background(.bar)
        }
        .background(Color.black)
        .navigationTitle("Chat")
        .task {
            state.markChatRead(nil)
            while !Task.isCancelled {
                await poll()
                try? await Task.sleep(for: .seconds(5))
            }
        }
    }

    @ViewBuilder
    private func bubble(_ m: ChatMessage) -> some View {
        let mine = m.userId == session.userId
        HStack {
            if mine { Spacer(minLength: 40) }
            VStack(alignment: mine ? .trailing : .leading, spacing: 4) {
                if !mine { Text(m.userName).font(.caption.bold()).foregroundStyle(Theme.dim) }
                VStack(alignment: .leading, spacing: 8) {
                    if let media = m.media {
                        TmdbLink(type: media.type, id: media.tmdbId) {
                            HStack(spacing: 10) {
                                AsyncImage(url: media.poster.flatMap(URL.init(string:))) { p in
                                    if case .success(let i) = p { i.resizable().scaledToFill() } else { Theme.surfaceHigh }
                                }
                                .frame(width: 44, height: 66).clipShape(RoundedRectangle(cornerRadius: 6))
                                VStack(alignment: .leading) {
                                    Text("Proposition").font(.caption2).foregroundStyle(.white.opacity(0.7))
                                    Text(media.title).font(.subheadline.bold())
                                    if let y = media.year { Text(y).font(.caption) }
                                }
                            }
                        }
                    }
                    if !m.text.isEmpty { Text(m.text) }
                }
                .padding(.horizontal, 12).padding(.vertical, 9)
                .background(mine ? Theme.accent : Theme.surfaceHigh, in: RoundedRectangle(cornerRadius: 16))
                Text(timeAgo(m.createdAt)).font(.caption2).foregroundStyle(Theme.dim)
            }
            .contextMenu {
                if mine || session.isAdmin {
                    Button("Supprimer", role: .destructive) {
                        Task {
                            try? await session.lumio.deleteMessage(m.id)
                            messages.removeAll { $0.id == m.id }
                        }
                    }
                }
            }
            if !mine { Spacer(minLength: 40) }
        }
    }

    private func poll() async {
        do {
            let r = try await session.lumio.messages(after: messages.last?.id)
            me = r.me
            let known = Set(messages.map(\.id))
            let fresh = r.messages.filter { !known.contains($0.id) }
            if !fresh.isEmpty {
                messages += fresh
                state.markChatRead(fresh.last?.createdAt)
            }
            error = nil
        } catch {
            if messages.isEmpty { self.error = error.localizedDescription }
        }
    }

    private func send() {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty, !sending else { return }
        sending = true
        Task {
            do {
                let m = try await session.lumio.sendMessage(t)
                text = ""
                messages.append(m)
                state.markChatRead(m.createdAt)
            } catch {
                Toast.shared.show(error.localizedDescription, error: true)
            }
            sending = false
        }
    }
}
