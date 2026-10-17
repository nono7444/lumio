import SwiftUI

struct LoginView: View {
    @Environment(AppSession.self) private var session
    @State private var server = ""
    @State private var user = ""
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(spacing: 22) {
                Image(systemName: "play.rectangle.fill")
                    .font(.system(size: 64))
                    .foregroundStyle(.white)
                    .padding(.top, 60)
                VStack(spacing: 6) {
                    Text("Lumio").font(.largeTitle.bold())
                    Text("Version Swift · test").font(.subheadline).foregroundStyle(Theme.dim)
                }
                VStack(spacing: 12) {
                    field("Serveur Jellyfin", text: $server, icon: "server.rack", prompt: "https://jellyfin.mondomaine.fr")
                    field("Utilisateur", text: $user, icon: "person", prompt: "Nom d'utilisateur")
                    HStack {
                        Image(systemName: "lock").foregroundStyle(Theme.dim).frame(width: 22)
                        SecureField("Mot de passe", text: $password)
                            .textContentType(.password)
                            .onSubmit(connect)
                    }
                    .padding(14)
                    .background(Theme.surfaceHigh, in: RoundedRectangle(cornerRadius: 14))
                }
                if let error {
                    Text(error).font(.footnote).foregroundStyle(.red).multilineTextAlignment(.center)
                }
                Button(action: connect) {
                    HStack {
                        if busy { ProgressView().tint(.black) }
                        Text("Se connecter").bold()
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(.white, in: RoundedRectangle(cornerRadius: 14))
                    .foregroundStyle(.black)
                }
                .buttonStyle(.plain)
                .disabled(busy || server.isEmpty || user.isEmpty)
            }
            .padding(24)
            .frame(maxWidth: 480)
            .frame(maxWidth: .infinity)
        }
        .background(Color.black.ignoresSafeArea())
        .onAppear { if server.isEmpty { server = session.serverURL } }
    }

    private func field(_ label: String, text: Binding<String>, icon: String, prompt: String) -> some View {
        HStack {
            Image(systemName: icon).foregroundStyle(Theme.dim).frame(width: 22)
            TextField(label, text: text, prompt: Text(prompt))
                .autocorrectionDisabled()
                #if os(iOS)
                .textInputAutocapitalization(.never)
                .keyboardType(icon == "server.rack" ? .URL : .default)
                #endif
        }
        .padding(14)
        .background(Theme.surfaceHigh, in: RoundedRectangle(cornerRadius: 14))
    }

    private func connect() {
        guard !busy else { return }
        busy = true
        error = nil
        Task {
            do {
                try await session.login(server: server, user: user, password: password)
            } catch {
                self.error = error.localizedDescription
            }
            busy = false
        }
    }
}
