import { openOrCreate } from '@akylas/nativescript-sqlite';
import { Component, OnInit } from '@angular/core';
import { isAndroid } from '@nativescript/core';
import { DatabaseService, initDatabase, RxHeroDocument } from '../../../core/services/database.service';
import { setStatusBarColor } from '../../../utils';

@Component({
  moduleId: module.id,
  selector: 'app-home',
  templateUrl: './home.component.html'
})
export class HomeComponent implements OnInit {

  uuid() {
    if( isAndroid ) {
      return java.util.UUID.randomUUID().toString();
    } else {
      return NSUUID.UUID().UUIDString.toLowerCase();
    }
  }

  constructor(private databaseService: DatabaseService ) {
    // const db = openOrCreate('/data/user/0/org.nativescript.rxdb/files/db/ns-sqlite-rxdb-0-hero-local.sqlite');
    // db.select(`
    //   SELECT
    //     name
    //   FROM
    //     sqlite_master
    //   WHERE
    //     type ='table' AND
    //     name NOT LIKE 'sqlite_%';`
    // ).then((res) => {
    //   console.log(res);
    // });

    // db.select('SELECT * FROM \"local-store\";').then((res)=> {
    //   console.log(res);
    // })

    // db.select('SELECT * FROM \"document-store\";').then((res)=> {
    //   console.log(res);
    // })

    // db.select('SELECT * FROM \"attach-store\";').then((res)=> {
    //   console.log(res);
    // })

    // db.select('SELECT * FROM \"metadata-store\";').then((res)=> {
    //   console.log(res);
    // })

    // db.select('SELECT * FROM \"names\";').then((res)=> {
    //   console.log(res);
    // })
    // console.log(this.database);


  }

  ngOnInit() {
    console.log('oninit');
    initDatabase();
    setStatusBarColor('dark', '#97d9e9');


  }

  addToCollection() {
    this.databaseService.db.collections.hero.insert({ "id": this.uuid(), name: 'SPODERMEN' } as any);
  }

  async tryQuery() {
    const result = await this.databaseService.db.collections.hero.find().exec();
    console.log(JSON.stringify(result));

    this.databaseService.db.collections.hero.find().$.subscribe((hero) => {
      console.log('hero', hero);
    })
    const db = openOrCreate('/data/user/0/org.nativescript.rxdb/files/db/ns-sqlite-rxdb-0-hero-local.sqlite');
    db.select(`
      SELECT
        name
      FROM
        sqlite_master
      WHERE
        type ='table' AND
        name NOT LIKE 'sqlite_%';`
    ).then((res) => {
      console.log(res);
    });

    db.select('SELECT * FROM "local-store";').then((res)=> {
      console.log(res);
    })

    db.select('SELECT * FROM "document-store";').then((res)=> {
      console.log(res);
    })

    db.select('SELECT * FROM "attach-store";').then((res)=> {
      console.log(res);
    })

    db.select('SELECT * FROM "metadata-store";').then((res)=> {
      console.log(res);
    })

  }
}
