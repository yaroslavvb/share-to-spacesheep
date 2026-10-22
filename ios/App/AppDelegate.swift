import UIKit

@main
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?
    private var rootBridgeVC: SpacesheepBridgeViewController?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let win = UIWindow(frame: UIScreen.main.bounds)
        let vc = SpacesheepBridgeViewController()
        vc.isShareExtension = false
        self.rootBridgeVC = vc
        win.rootViewController = vc
        win.makeKeyAndVisible()
        self.window = win

        if let url = launchOptions?[.url] as? URL {
            vc.handleIncomingUrl(url)
        }
        return true
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey : Any] = [:]) -> Bool {
        rootBridgeVC?.handleIncomingUrl(url)
        return true
    }
}
