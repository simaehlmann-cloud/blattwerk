#import <Cordova/CDVPlugin.h>
#import <StoreKit/StoreKit.h>

@interface BWReview : CDVPlugin
- (void)request:(CDVInvokedUrlCommand*)command;
@end

@implementation BWReview

- (void)request:(CDVInvokedUrlCommand*)command
{
    dispatch_async(dispatch_get_main_queue(), ^{
        UIWindowScene* scene = self.viewController.view.window.windowScene;
        if (scene != nil) {
            [SKStoreReviewController requestReviewInScene:scene];
        }
        CDVPluginResult* res = [CDVPluginResult resultWithStatus:(scene != nil ? CDVCommandStatus_OK : CDVCommandStatus_ERROR)];
        [self.commandDelegate sendPluginResult:res callbackId:command.callbackId];
    });
}

@end
