import { APP_INITIALIZER, NgModule, NO_ERRORS_SCHEMA } from '@angular/core';
import { CoreModule } from './core/core.module';
import { SharedModule } from './features/shared/shared.module';
import { AppRoutingModule } from './app.routing';
import { AppComponent } from './app.component';
import { DatabaseService, initDatabase } from './core/services/database.service';
import { SubscriptionService } from './core/services/subscription.service';

@NgModule({
  imports: [CoreModule, SharedModule, AppRoutingModule],
  declarations: [AppComponent],
  bootstrap: [AppComponent],
  schemas: [NO_ERRORS_SCHEMA],
  providers: [
    // {
    //   provide: APP_INITIALIZER,
    //   useFactory: () => initDatabase,
    //   multi: true,
    //   deps: [SubscriptionService]
    // },
    DatabaseService,
    SubscriptionService
  ]
})
export class AppModule {}
