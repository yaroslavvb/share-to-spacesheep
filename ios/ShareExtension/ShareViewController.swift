import UIKit

@objc(ShareViewController)
public class ShareViewController: SpacesheepBridgeViewController {
    public override func viewDidLoad() {
        self.isShareExtension = true
        super.viewDidLoad()
    }
}
