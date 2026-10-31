// Connexion à Jellyfin (même compte que l'appli iPhone).
import SwiftUI

struct LoginView: View {
    @EnvironmentObject var session: Session
    @State private var server = ""
    @State private var user = ""
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            VStack(spacing: 18) {
                Image(nsImage: NSApp.applicationIconImage)
                    .resizable()
                    .frame(width: 96, height: 96)
                Text("Lumio")
                    .font(.system(size: 34, weight: .heavy))
                Text("Connecte-toi avec ton compte Jellyfin.")
                    .foregroundStyle(Theme.dim)
                VStack(spacing: 10) {
                    field("Adresse du serveur", text: $server)
                    field("Identifiant", text: $user)
                    SecureField("Mot de passe", text: $password)
                        .textFieldStyle(.plain)
                        .padding(12)
                        .background(Theme.surfaceHigh, in: RoundedRectangle(cornerRadius: 10))
                        .onSubmit(connect)
                }
                .frame(width: 340)
                .padding(.top, 8)
                if let error {
                    Text(error).foregroundStyle(.red).font(.callout).frame(width: 340)
                }
                Button(action: connect) {
                    Group {
                        if busy { ProgressView().controlSize(.small) } else { Text("Se connecter").fontWeight(.semibold) }
                    }
                    .frame(width: 340, height: 38)
                    .background(Theme.accent, in: RoundedRectangle(cornerRadius: 10))
                    .foregroundStyle(.white)
                }
                .buttonStyle(.plain)
                .disabled(busy || user.isEmpty)
                .keyboardShortcut(.defaultAction)
            }
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear { if server.isEmpty { server = session.lastServer } }
    }

    private func field(_ label: String, text: Binding<String>) -> some View {
        TextField(label, text: text)
            .textFieldStyle(.plain)
            .padding(12)
            .background(Theme.surfaceHigh, in: RoundedRectangle(cornerRadius: 10))
            .onSubmit(connect)
    }

    private func connect() {
        guard !busy, !user.isEmpty else { return }
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
