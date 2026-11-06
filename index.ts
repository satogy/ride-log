// バックグラウンド起動時にもタスクが登録されているよう、最初に読み込む
import './src/recording';

import { registerRootComponent } from 'expo';

import App from './App';

registerRootComponent(App);
