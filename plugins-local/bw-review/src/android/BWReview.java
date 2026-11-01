package de.blattwerk.review;

import android.app.Activity;

import com.google.android.play.core.review.ReviewInfo;
import com.google.android.play.core.review.ReviewManager;
import com.google.android.play.core.review.ReviewManagerFactory;

import org.apache.cordova.CallbackContext;
import org.apache.cordova.CordovaPlugin;
import org.json.JSONArray;

public class BWReview extends CordovaPlugin {
    @Override
    public boolean execute(String action, JSONArray args, final CallbackContext cb) {
        if (!"request".equals(action)) return false;
        final Activity activity = cordova.getActivity();
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    final ReviewManager manager = ReviewManagerFactory.create(activity);
                    manager.requestReviewFlow().addOnCompleteListener(task -> {
                        if (!task.isSuccessful()) { cb.error("nicht verfügbar"); return; }
                        ReviewInfo info = task.getResult();
                        manager.launchReviewFlow(activity, info).addOnCompleteListener(t -> cb.success());
                    });
                } catch (Exception e) {
                    cb.error(String.valueOf(e.getMessage()));
                }
            }
        });
        return true;
    }
}
